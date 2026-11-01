//! Minimal single-instance guard + "raise the existing window" channel.
//!
//! WHY THIS EXISTS
//! ---------------
//! Mourn ships as an *uninstalled* AppImage on Linux, so the app has no
//! launcher entry the desktop can use to restore it. Minimizing is therefore a
//! one-way trip on a desktop that cannot bring the window back — an
//! undecorated XWayland window (which is what the AppImage used to be forced
//! into) or a session with no system tray. The only recovery a user has is to
//! launch the app again, and until now that started a SECOND process: it never
//! surfaced the minimized window, and the two processes contended for the same
//! vault SQLite file and keyring entry. That is the "minimized and it won't
//! open again until I close and reopen" report.
//!
//! WHAT IT DOES
//! ------------
//! The first instance binds a loopback port derived from the app identity.
//! A later instance connects, sends a magic token, and exits; the first
//! instance answers the token by showing/unminimizing/focusing its main window.
//!
//! SAFETY: this guard *fails open*. The only path that ends the process is
//! "we connected to something and it answered with our exact token". A port
//! held by an unrelated program, a blocked loopback, or any I/O error all fall
//! through to normal startup, so this can never stop Mourn from launching.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::time::Duration;

/// Token a secondary sends to ask the primary to present its window, and the
/// acknowledgement the primary sends back. Both are exact-match.
const RAISE_TOKEN: &[u8] = b"MOURN-RAISE-1";
const RAISE_ACK: &[u8] = b"OK";

const CONNECT_TIMEOUT: Duration = Duration::from_millis(500);
const IO_TIMEOUT: Duration = Duration::from_millis(750);

/// Deterministic, app-specific loopback port. Bound on 127.0.0.1 only, never
/// exposed, and never spoken to with anything but [`RAISE_TOKEN`].
const GUARD_PORT: u16 = 47_611;

fn guard_addr() -> SocketAddr {
    SocketAddr::from((Ipv4Addr::LOCALHOST, GUARD_PORT))
}

/// Outcome of the startup claim.
pub enum Claim {
    /// We own the guard. Keep the listener alive by handing it to
    /// [`spawn_raise_server`].
    Primary(TcpListener),
    /// Another Mourn instance owns the guard and has been asked to raise its
    /// window. The caller must exit.
    Secondary,
    /// The guard could not be established (port held by something that is not
    /// us, loopback unavailable, …). Start normally without a guard rather than
    /// refusing to run.
    Unguarded,
}

/// Claim the single-instance guard, or ask the running instance to present
/// itself. Never fails: see [`Claim::Unguarded`].
pub fn claim() -> Claim {
    match TcpListener::bind(guard_addr()) {
        Ok(listener) => Claim::Primary(listener),
        Err(_) => {
            // Nobody of ours is listening if the peer does not speak the token.
            if ask_peer_to_raise() {
                Claim::Secondary
            } else {
                Claim::Unguarded
            }
        }
    }
}

/// Connect to a presumed primary and ask it to raise its window.
/// Returns `true` only if it answered with our acknowledgement.
fn ask_peer_to_raise() -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&guard_addr(), CONNECT_TIMEOUT) else {
        return false;
    };
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    if stream.write_all(RAISE_TOKEN).is_err() || stream.flush().is_err() {
        return false;
    }
    let mut ack = [0u8; RAISE_ACK.len()];
    match stream.read_exact(&mut ack) {
        Ok(()) => ack == RAISE_ACK,
        Err(_) => false,
    }
}

/// Serve the guard port. Runs for the lifetime of the process; the closure is
/// invoked (on the guard thread) whenever a later instance asks for the window.
pub fn spawn_raise_server<F>(listener: TcpListener, on_raise: F)
where
    F: Fn() + Send + 'static,
{
    std::thread::spawn(move || {
        for incoming in listener.incoming() {
            let Ok(mut stream) = incoming else {
                continue;
            };
            let _ = stream.set_read_timeout(Some(IO_TIMEOUT));

            let mut token = [0u8; RAISE_TOKEN.len()];
            if stream.read_exact(&mut token).is_err() || token != RAISE_TOKEN {
                // Not one of ours (or a truncated read) — say nothing.
                continue;
            }

            let _ = stream.write_all(RAISE_ACK);
            let _ = stream.flush();
            on_raise();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn primary_owns_the_guard_and_answers_a_secondary() {
        // If something (a real running Mourn, another test) already owns the
        // guard, that is not a failure of this test.
        let listener = match claim() {
            Claim::Primary(listener) => listener,
            _ => return,
        };

        let (raised_tx, raised_rx) = mpsc::channel();
        spawn_raise_server(listener, move || {
            let _ = raised_tx.send(());
        });

        assert!(
            ask_peer_to_raise(),
            "the primary must acknowledge the token"
        );
        assert_eq!(
            raised_rx.recv_timeout(Duration::from_secs(2)),
            Ok(()),
            "the primary must be asked to raise its window"
        );

        // Foreign traffic on the port must NOT be acknowledged — that is what
        // keeps a port held by an unrelated program from being mistaken for a
        // running Mourn (which would make the app exit on launch).
        if let Ok(mut bogus) = TcpStream::connect_timeout(&guard_addr(), CONNECT_TIMEOUT) {
            let _ = bogus.write_all(b"GET / HTTP/1.0\r\n\r\n");
            let _ = bogus.set_read_timeout(Some(IO_TIMEOUT));
            let mut buf = [0u8; RAISE_ACK.len()];
            // Closed without a reply, or a zero-length read: both mean "no ack".
            assert!(matches!(bogus.read(&mut buf), Ok(0) | Err(_)));
        }
    }
}
