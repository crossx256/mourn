// src-tauri/src/discord_rpc.rs
//
// Mourn's own Discord Rich Presence transport.
//
// WHY NOT JUST USE THE CRATE'S `connect()`:
// `discord-rich-presence` 1.1.0 (`ipc_unix.rs::find_pipe`) walks its candidate
// paths and returns the FIRST one that merely `.exists()`, then
// `connect_ipc()` opens that one path exactly once. On Linux that is a real
// bug in two ways:
//
//   1. A STALE socket file left behind by an exited Flatpak/Snap Discord still
//      exists, so it shadows the live socket and the single attempt fails with
//      ECONNREFUSED ("failed to connect to IPC socket").
//   2. There is exactly ONE attempt, made at launch. If Discord is started
//      after Mourn, the failure is permanent until the user toggles the setting.
//
// We therefore keep the crate for what it is good at — building the
// `activity::Activity` payload (and its dependency pin) — and resolve/connect
// ourselves: enumerate EVERY candidate endpoint and keep the first one that
// actually accepts a connection AND completes the handshake. A dead socket can
// never shadow a live one, because we test the connection instead of the path.
//
// Wire protocol (Discord IPC): 8-byte header = op(u32 LE) ‖ len(u32 LE),
// followed by `len` bytes of UTF-8 JSON.

use serde_json::{json, Value};
use std::io::{Read, Write};

/// op 0 = handshake, op 1 = frame, op 2 = close (us), op 3 = close from Discord.
const OP_HANDSHAKE: u32 = 0;
const OP_FRAME: u32 = 1;
const OP_CLOSE: u32 = 2;
/// Discord uses op 3 (not op 2) to reject/close a link — e.g. an invalid
/// application id. Verified against a live client with
/// `scripts/discord_ipc_probe.py`: a good handshake answers `(1, …READY…)`,
/// a rejection answers `(3, …)`. Treating only op 2 as failure would report
/// "connected" for a socket Discord had just refused.
const OP_CLOSE_FROM_DISCORD: u32 = 3;

/// A non-Discord socket can connect and then never answer; never block forever.
#[cfg(unix)]
const IPC_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Frames from a real Discord are tiny; anything larger means we are talking to
/// something that is not Discord, so refuse instead of allocating blindly.
const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;

#[cfg(unix)]
type IpcStream = std::os::unix::net::UnixStream;
#[cfg(windows)]
type IpcStream = std::fs::File;

/// Candidate IPC endpoints in probe order.
///
/// Mirrors the crate's search space (so no install layout regresses) but is
/// probed rather than "first file wins".
#[cfg(unix)]
fn candidate_paths() -> Vec<String> {
    const ENV_KEYS: [&str; 4] = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"];
    const SUBPATHS: [&str; 7] = [
        "",                                         // native install
        "app/com.discordapp.Discord/",              // Flatpak (host view)
        "app/dev.vencord.Vesktop/",                 // Flatpak Vesktop
        ".flatpak/com.discordapp.Discord/xdg-run/", // Flatpak (sandbox view)
        ".flatpak/dev.vencord.Vesktop/xdg-run/",    // Flatpak Vesktop (sandbox)
        "snap.discord-canary/",                     // Snap
        "snap.discord/",                            // Snap
    ];

    let snap = std::env::var("SNAP").is_ok();
    let mut out: Vec<String> = Vec::new();

    for (index, key) in ENV_KEYS.iter().enumerate() {
        let Ok(value) = std::env::var(key) else {
            continue;
        };
        if value.trim().is_empty() {
            continue;
        }

        // Inside a Snap, XDG_RUNTIME_DIR points at the private snap runtime; the
        // host's Discord socket lives one directory up (same rule as the crate).
        let base = if snap && index == 0 {
            match value.rsplit_once('/') {
                Some((parent, _)) if !parent.is_empty() => parent.to_string(),
                _ => value.clone(),
            }
        } else {
            value.clone()
        };

        if !std::path::Path::new(&base).is_dir() {
            continue;
        }

        let base = base.trim_end_matches('/');
        for i in 0..10 {
            for sub in SUBPATHS {
                let candidate = format!("{base}/{sub}discord-ipc-{i}");
                if !out.contains(&candidate) {
                    out.push(candidate);
                }
            }
        }
    }

    out
}

#[cfg(windows)]
fn candidate_paths() -> Vec<String> {
    (0..10)
        .map(|i| format!(r"\\?\pipe\discord-ipc-{i}"))
        .collect()
}

#[cfg(unix)]
fn open_candidate(path: &str) -> std::io::Result<IpcStream> {
    fn connect(path: &str) -> std::io::Result<IpcStream> {
        let stream = std::os::unix::net::UnixStream::connect(path)?;
        stream.set_read_timeout(Some(IPC_TIMEOUT))?;
        stream.set_write_timeout(Some(IPC_TIMEOUT))?;
        Ok(stream)
    }
    connect(path)
}

#[cfg(windows)]
fn open_candidate(path: &str) -> std::io::Result<IpcStream> {
    use std::os::windows::fs::OpenOptionsExt;
    // GENERIC_READ | GENERIC_WRITE, matching what the Discord IPC pipe expects.
    std::fs::OpenOptions::new().access_mode(0x3).open(path)
}

/// Resolved Discord IPC connection.
pub struct DiscordIpc {
    client_id: String,
    stream: Option<IpcStream>,
}

impl DiscordIpc {
    pub fn new(client_id: &str) -> Self {
        Self {
            client_id: client_id.to_string(),
            stream: None,
        }
    }

    /// Connect to the first candidate endpoint that both accepts a connection
    /// and completes the Discord handshake. Stale/short-circuit sockets are
    /// skipped instead of winning.
    pub fn connect(&mut self) -> Result<(), String> {
        let candidates = candidate_paths();
        if candidates.is_empty() {
            return Err(
                "discord ipc: no candidate socket path (XDG_RUNTIME_DIR/TMPDIR are unset)"
                    .to_string(),
            );
        }

        let mut probed = 0usize;
        let mut last_error: Option<String> = None;

        for path in &candidates {
            // On unix, skip paths that are not even present so `probed` counts
            // real socket files. Windows named pipes cannot be stat'd this way.
            #[cfg(unix)]
            if !std::path::Path::new(path).exists() {
                continue;
            }

            probed += 1;

            match open_candidate(path) {
                Ok(stream) => {
                    self.stream = Some(stream);
                    match self.handshake() {
                        Ok(()) => return Ok(()),
                        Err(err) => {
                            // Connected but not to a Discord IPC — drop it and
                            // keep probing the remaining candidates.
                            last_error = Some(format!("{path}: {err}"));
                            self.disconnect();
                        }
                    }
                }
                Err(err) => {
                    last_error = Some(format!("{path}: {err}"));
                }
            }
        }

        Err(match (probed, last_error) {
            (0, _) => {
                "discord ipc: no socket found — Discord does not appear to be running".to_string()
            }
            (_, Some(err)) => format!(
                "discord ipc: found {probed} socket file(s) but none accepted a live connection — \
                 Discord looks closed, or every socket is stale. last: {err}"
            ),
            _ => "discord ipc: no socket found — Discord does not appear to be running".to_string(),
        })
    }

    /// Send the v1 handshake and read Discord's answer, surfacing an ERROR
    /// frame verbatim (e.g. an invalid application id) instead of swallowing it.
    fn handshake(&mut self) -> Result<(), String> {
        self.send(
            OP_HANDSHAKE,
            &json!({ "v": 1, "client_id": self.client_id }),
        )?;

        let (op, payload) = self.recv()?;
        // op 3 is how Discord itself closes/refuses a link; op 2 is the close WE
        // send. Both mean "this handshake did not succeed" — checking only op 2
        // would let a rejected client id pass as connected.
        if op == OP_CLOSE || op == OP_CLOSE_FROM_DISCORD {
            let reason = payload
                .get("data")
                .and_then(|data| data.get("message"))
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| payload.to_string());
            return Err(format!("handshake rejected (op {op}): {reason}"));
        }
        if payload.get("evt").and_then(Value::as_str) == Some("ERROR") {
            let code = payload
                .get("data")
                .and_then(|data| data.get("code"))
                .and_then(Value::as_i64)
                .unwrap_or_default();
            let message = payload
                .get("data")
                .and_then(|data| data.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("unknown error");
            return Err(format!("handshake rejected ({code}): {message}"));
        }

        Ok(())
    }

    /// Publish the given activity. Owns no retry logic — the caller decides.
    pub fn set_activity(
        &mut self,
        activity: &discord_rich_presence::activity::Activity<'_>,
    ) -> Result<(), String> {
        let payload = json!({
            "cmd": "SET_ACTIVITY",
            "args": { "pid": std::process::id(), "activity": activity },
            "nonce": nonce(),
        });
        self.send(OP_FRAME, &payload)
    }

    /// Politely close the IPC link. Safe to call when not connected.
    pub fn close(&mut self) -> Result<(), String> {
        if self.stream.is_none() {
            return Ok(());
        }
        // Best effort: Discord drops the presence when the socket closes, so a
        // failed close frame must not turn into a user-visible error.
        let _ = self.send(OP_CLOSE, &json!({}));
        self.disconnect();
        Ok(())
    }

    fn disconnect(&mut self) {
        if let Some(mut stream) = self.stream.take() {
            let _ = stream.flush();
            #[cfg(unix)]
            {
                let _ = stream.shutdown(std::net::Shutdown::Both);
            }
        }
    }

    fn send(&mut self, opcode: u32, payload: &Value) -> Result<(), String> {
        let body = payload.to_string();
        let mut frame = Vec::with_capacity(8 + body.len());
        frame.extend_from_slice(&opcode.to_le_bytes());
        frame.extend_from_slice(&(body.len() as u32).to_le_bytes());
        frame.extend_from_slice(body.as_bytes());

        let stream = self
            .stream
            .as_mut()
            .ok_or_else(|| "discord ipc: not connected".to_string())?;
        stream
            .write_all(&frame)
            .map_err(|err| format!("discord ipc write failed: {err}"))
    }

    fn recv(&mut self) -> Result<(u32, Value), String> {
        let mut header = [0u8; 8];
        {
            let stream = self
                .stream
                .as_mut()
                .ok_or_else(|| "discord ipc: not connected".to_string())?;
            stream
                .read_exact(&mut header)
                .map_err(|err| format!("discord ipc read failed: {err}"))?;
        }

        let opcode = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
        let length = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
        if length > MAX_FRAME_BYTES {
            return Err(format!("discord ipc: oversized frame ({length} bytes)"));
        }

        let mut data = vec![0u8; length];
        {
            let stream = self
                .stream
                .as_mut()
                .ok_or_else(|| "discord ipc: not connected".to_string())?;
            stream
                .read_exact(&mut data)
                .map_err(|err| format!("discord ipc read failed: {err}"))?;
        }

        let text = String::from_utf8_lossy(&data).to_string();
        let value = serde_json::from_str(&text).unwrap_or(Value::Null);
        Ok((opcode, value))
    }
}

/// Random-ish unique nonce. Discord only requires uniqueness per request.
fn nonce() -> String {
    let mut bytes = [0u8; 16];
    if getrandom::getrandom(&mut bytes).is_ok() {
        return hex::encode(bytes);
    }
    format!(
        "{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_millis()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidates_are_deduped_and_include_native_and_flatpak_layouts() {
        std::env::set_var("XDG_RUNTIME_DIR", "/run/user/1000");
        std::env::remove_var("SNAP");
        let paths = candidate_paths();
        assert!(paths.contains(&"/run/user/1000/discord-ipc-0".to_string()));
        assert!(
            paths.contains(&"/run/user/1000/app/com.discordapp.Discord/discord-ipc-0".to_string())
        );
        let mut unique = paths.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), paths.len(), "candidate list must be deduped");
    }
}
