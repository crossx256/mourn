//! Verified download only. There is deliberately no privileged installer here.
use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::time::Duration;
use tauri::Manager;

const MAX_PACKAGE_BYTES: usize = 512 * 1024 * 1024;
const HOSTS: &[&str] = &[
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "mourn.bio",
];

pub fn is_flatpak() -> bool {
    cfg!(target_os = "linux")
        && (std::path::Path::new("/.flatpak-info").exists()
            || std::env::var_os("FLATPAK_ID").is_some())
}

fn supported_environment(linux: bool, flatpak: bool) -> Result<(), String> {
    if flatpak {
        return Err("Native updates are disabled in Flatpak; use flatpak update".into());
    }
    if !linux {
        return Err("deb downloads are only supported on Linux".into());
    }
    Ok(())
}

fn tauri_text_document(value: &str) -> Result<String, String> {
    if value.len() > 16384 {
        return Err("updater verification document exceeds size limit".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(value.trim())
        .map_err(|_| "invalid Tauri verification envelope")?;
    String::from_utf8(bytes).map_err(|_| "updater verification document is not UTF-8".into())
}

fn trusted_url(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && url
            .host_str()
            .map(|host| HOSTS.contains(&host))
            .unwrap_or(false)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebHandoff {
    pub status: &'static str,
    pub path: String,
    pub sha256: String,
    pub signature: String,
    pub instructions: &'static str,
}

/// Kept so older frontends get an actionable failure, not a false "installed"
/// result followed by a restart prompt. Switch to prepare_linux_deb_update.
#[tauri::command]
pub async fn install_linux_deb_update(
    _app: tauri::AppHandle,
    _url: String,
    _signature: String,
) -> Result<String, String> {
    supported_environment(cfg!(target_os = "linux"), is_flatpak())?;
    Err("Automatic deb installation has been removed. Download with prepare_linux_deb_update, then install manually with your package manager".into())
}

#[tauri::command]
pub async fn prepare_linux_deb_update(
    app: tauri::AppHandle,
    url: String,
    signature: String,
) -> Result<DebHandoff, String> {
    supported_environment(cfg!(target_os = "linux"), is_flatpak())?;
    let parsed = reqwest::Url::parse(&url).map_err(|_| "invalid update URL")?;
    if !trusted_url(&parsed) || !parsed.path().ends_with(".deb") {
        return Err("update must be an HTTPS deb on an approved release host".into());
    }
    let plugins =
        serde_json::to_value(&app.config().plugins).map_err(|_| "invalid updater configuration")?;
    let pubkey = plugins
        .get("updater")
        .and_then(|value| value.get("pubkey"))
        .and_then(|value| value.as_str())
        .ok_or("updater public key not configured")?;
    // Tauri wraps the full Minisign text documents, not their binary lines.
    let key = minisign_verify::PublicKey::decode(&tauri_text_document(pubkey)?)
        .map_err(|_| "invalid updater public key")?;
    let sig = minisign_verify::Signature::decode(&tauri_text_document(&signature)?)
        .map_err(|_| "invalid update signature")?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(900))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !trusted_url(attempt.url()) {
                attempt.error("untrusted update redirect")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| "update client initialization failed")?;
    let mut response = client
        .get(parsed)
        .send()
        .await
        .map_err(|_| "update download failed")?
        .error_for_status()
        .map_err(|_| "update download failed")?;
    if response
        .content_length()
        .map(|size| size > MAX_PACKAGE_BYTES as u64)
        .unwrap_or(false)
    {
        return Err("update package exceeds size limit".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "update download failed")?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_PACKAGE_BYTES {
            return Err("update package exceeds size limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    key.verify(&bytes, &sig, true)
        .map_err(|_| "update signature verification failed")?;
    let sha256 = hex::encode(Sha256::digest(&bytes));
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "app data directory unavailable")?
        .join("verified-downloads");
    std::fs::create_dir_all(&dir).map_err(|_| "download directory creation failed")?;
    // Exclusive random file, never a predictable shared /tmp pathname. This
    // limits collisions; it is NOT authentication against same-user tampering.
    let mut file = tempfile::Builder::new()
        .prefix("mourn-")
        .suffix(".deb")
        .tempfile_in(&dir)
        .map_err(|_| "download file creation failed")?;
    file.write_all(&bytes)
        .map_err(|_| "download file write failed")?;
    file.as_file()
        .sync_all()
        .map_err(|_| "download file sync failed")?;
    let (_, path) = file.keep().map_err(|_| "download file retention failed")?;
    Ok(DebHandoff {
        status: "manual-install-required", path: path.to_string_lossy().into_owned(), sha256, signature,
        instructions: "Downloaded and signature-verified, not installed. Use your package manager manually. A user-writable file can change after verification: verify it again in a trusted installation workflow. The app does not authenticate a later privileged install.",
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tauri_public_key_is_an_outer_encoded_minisign_document() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let encoded = config["plugins"]["updater"]["pubkey"].as_str().unwrap();
        let document = tauri_text_document(encoded).unwrap();
        assert!(minisign_verify::PublicKey::decode(&document).is_ok());
        assert!(tauri_text_document("not base64").is_err());
        assert!(tauri_text_document(&"A".repeat(16385)).is_err());
    }
    #[test]
    fn flatpak_cannot_use_native_update_commands() {
        assert!(supported_environment(true, true).is_err());
        assert!(supported_environment(false, false).is_err());
        assert!(supported_environment(true, false).is_ok());
    }
    #[test]
    fn release_url_policy_rejects_credentials_ports_and_foreign_redirects() {
        for url in [
            "http://github.com/a.deb",
            "https://github.com.evil.test/a.deb",
            "https://user:password@github.com/a.deb",
            "https://github.com:444/a.deb",
        ] {
            assert!(!trusted_url(&reqwest::Url::parse(url).unwrap()));
        }
        assert!(trusted_url(
            &reqwest::Url::parse("https://release-assets.githubusercontent.com/a.deb").unwrap()
        ));
    }
}
