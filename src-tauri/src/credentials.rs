//! OS-keychain secrets and serialized, atomic, metadata-only account indexing.
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use tauri::Manager;

const LEGACY_SERVICE: &str = "mourn-desktop";
const ACCOUNT_SERVICE: &str = "mourn-desktop-accounts-v2";
const INTERNAL_SERVICE: &str = "mourn-desktop-internal-v2";
const OFFLINE_SLOT: &str = "offline_vault_key";
const MAX_ACCOUNTS: usize = 2;
// Covers the full read/keychain/migrate/modify/publish operation, not just file IO.
static STORE_LOCK: Mutex<()> = Mutex::new(());

type Index = HashMap<String, Metadata>;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Metadata {
    last_used: i64,
    stay_logged_in: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredCredential {
    username: String,
    password: String,
    last_used: i64,
    stay_logged_in: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    username: String,
    last_used: i64,
    stay_logged_in: bool,
}

fn index_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "app data directory unavailable")?
        .join("credential_index.json"))
}

fn read_index(path: &Path) -> Result<Index, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| "credential metadata is corrupt; not overwritten".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Index::new()),
        Err(_) => Err("credential metadata could not be read".into()),
    }
}

fn save_index(path: &Path, index: &Index) -> Result<(), String> {
    let bytes =
        serde_json::to_vec(index).map_err(|_| "credential metadata serialization failed")?;
    crate::atomic_file::write(path, &bytes)
        .map_err(|_| "credential metadata could not be saved".into())
}

fn entry(service: &str, name: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, name).map_err(|_| "OS keychain unavailable".into())
}
fn get(service: &str, name: &str) -> Result<Option<String>, String> {
    match entry(service, name)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("OS keychain read failed".into()),
    }
}
fn set(service: &str, name: &str, value: &str) -> Result<(), String> {
    entry(service, name)?
        .set_password(value)
        .map_err(|_| "OS keychain write failed".into())
}
fn delete(service: &str, name: &str) -> Result<(), String> {
    match entry(service, name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("OS keychain deletion failed".into()),
    }
}

fn canonical_offline_key(value: &str) -> Option<String> {
    URL_SAFE_NO_PAD
        .decode(value)
        .or_else(|_| STANDARD.decode(value))
        .ok()
        .filter(|bytes| bytes.len() == 32)
        .map(|bytes| URL_SAFE_NO_PAD.encode(bytes))
}

fn legacy_account_allowed(username: &str) -> bool {
    // This name had two meanings in v1. Never expose a possible master key as
    // a password or delete it when removing an account. Explicit upsert in v2
    // is safe, but ambiguous legacy values require user recovery.
    username != OFFLINE_SLOT
}

fn account_get(index: &Index, username: &str) -> Result<Option<String>, String> {
    if let Some(value) = get(ACCOUNT_SERVICE, username)? {
        return Ok(Some(value));
    }
    if !index.contains_key(username) {
        return Ok(None);
    }
    if !legacy_account_allowed(username) {
        return Err("ambiguous legacy keychain slot; re-enter this account password".into());
    }
    if let Some(value) = get(LEGACY_SERVICE, username)? {
        // Copy before delete. A failed migration leaves the original recoverable.
        set(ACCOUNT_SERVICE, username, &value)?;
        delete(LEGACY_SERVICE, username)?;
        return Ok(Some(value));
    }
    Ok(None)
}

#[tauri::command]
pub fn secure_store_upsert(
    app: tauri::AppHandle,
    username: String,
    password: String,
    stay_logged_in: Option<bool>,
) -> Result<(), String> {
    if username.trim().is_empty() || username.len() > 200 || password.is_empty() {
        return Err("username/password are required".into());
    }
    let _guard = STORE_LOCK
        .lock()
        .map_err(|_| "credential store lock failed")?;
    let path = index_path(&app)?;
    let mut index = read_index(&path)?;
    set(ACCOUNT_SERVICE, &username, &password)?;
    index.insert(
        username,
        Metadata {
            last_used: chrono::Utc::now().timestamp_millis(),
            stay_logged_in: stay_logged_in.unwrap_or(false),
        },
    );
    let mut ordered: Vec<_> = index
        .iter()
        .map(|(name, meta)| (name.clone(), meta.last_used))
        .collect();
    ordered.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let evicted: Vec<_> = ordered
        .into_iter()
        .skip(MAX_ACCOUNTS)
        .map(|(name, _)| name)
        .collect();
    for name in &evicted {
        index.remove(name);
    }
    // Publish metadata first: failed secret cleanup must not make a removed
    // account visible again. OS keychain + filesystem are not one transaction.
    save_index(&path, &index)?;
    for name in evicted {
        delete(ACCOUNT_SERVICE, &name)?;
        if legacy_account_allowed(&name) {
            delete(LEGACY_SERVICE, &name)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn secure_store_get(
    app: tauri::AppHandle,
    username: String,
) -> Result<Option<StoredCredential>, String> {
    let _guard = STORE_LOCK
        .lock()
        .map_err(|_| "credential store lock failed")?;
    let path = index_path(&app)?;
    let mut index = read_index(&path)?;
    let Some(mut meta) = index.get(&username).cloned() else {
        return Ok(None);
    };
    let Some(password) = account_get(&index, &username)? else {
        return Ok(None);
    };
    meta.last_used = chrono::Utc::now().timestamp_millis();
    index.insert(username.clone(), meta.clone());
    save_index(&path, &index)?;
    Ok(Some(StoredCredential {
        username,
        password,
        last_used: meta.last_used,
        stay_logged_in: meta.stay_logged_in,
    }))
}

#[tauri::command]
pub fn secure_store_list(app: tauri::AppHandle) -> Result<Vec<Summary>, String> {
    let _guard = STORE_LOCK
        .lock()
        .map_err(|_| "credential store lock failed")?;
    let mut list: Vec<_> = read_index(&index_path(&app)?)?
        .into_iter()
        .map(|(username, meta)| Summary {
            username,
            last_used: meta.last_used,
            stay_logged_in: meta.stay_logged_in,
        })
        .collect();
    list.sort_by(|a, b| {
        b.last_used
            .cmp(&a.last_used)
            .then(a.username.cmp(&b.username))
    });
    list.truncate(MAX_ACCOUNTS);
    Ok(list)
}

#[tauri::command]
pub fn secure_store_remove(app: tauri::AppHandle, username: String) -> Result<(), String> {
    let _guard = STORE_LOCK
        .lock()
        .map_err(|_| "credential store lock failed")?;
    let path = index_path(&app)?;
    let mut index = read_index(&path)?;
    index.remove(&username);
    save_index(&path, &index)?;
    delete(ACCOUNT_SERVICE, &username)?;
    if legacy_account_allowed(&username) {
        delete(LEGACY_SERVICE, &username)?;
    }
    Ok(())
}

#[tauri::command]
pub fn offline_vault_get_key(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let _guard = STORE_LOCK
        .lock()
        .map_err(|_| "credential store lock failed")?;
    if let Some(value) = get(INTERNAL_SERVICE, OFFLINE_SLOT)? {
        let canonical =
            canonical_offline_key(&value).ok_or("invalid offline vault key in OS keychain")?;
        if value != canonical {
            set(INTERNAL_SERVICE, OFFLINE_SLOT, &canonical)?;
        }
        return Ok(Some(canonical));
    }
    let index = read_index(&index_path(&app)?)?;
    if index.contains_key(OFFLINE_SLOT) {
        return Err("ambiguous legacy offline key; preserved for manual recovery".into());
    }
    if let Some(value) = get(LEGACY_SERVICE, OFFLINE_SLOT)? {
        let value = canonical_offline_key(&value)
            .ok_or("invalid legacy offline key; preserved for recovery")?;
        set(INTERNAL_SERVICE, OFFLINE_SLOT, &value)?;
        delete(LEGACY_SERVICE, OFFLINE_SLOT)?;
        return Ok(Some(value));
    }
    Ok(None)
}

#[tauri::command]
pub fn offline_vault_set_key(_app: tauri::AppHandle, key_b64: String) -> Result<(), String> {
    let key_b64 = canonical_offline_key(&key_b64)
        .ok_or("offline vault key must be a base64-encoded 32-byte key")?;
    let _guard = STORE_LOCK
        .lock()
        .map_err(|_| "credential store lock failed")?;
    if let Some(existing) = get(INTERNAL_SERVICE, OFFLINE_SLOT)? {
        if canonical_offline_key(&existing).as_deref() != Some(key_b64.as_str()) {
            return Err("existing offline vault key preserved; implicit rotation refused".into());
        }
        if existing == key_b64 {
            return Ok(());
        }
    }
    set(INTERNAL_SERVICE, OFFLINE_SLOT, &key_b64)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn namespaces_and_collision_policy_are_distinct() {
        assert_ne!(ACCOUNT_SERVICE, INTERNAL_SERVICE);
        assert_ne!(ACCOUNT_SERVICE, LEGACY_SERVICE);
        assert!(!legacy_account_allowed(OFFLINE_SLOT));
        assert!(legacy_account_allowed("alice"));
    }
    #[test]
    fn offline_keys_accept_url_safe_no_pad() {
        let key = URL_SAFE_NO_PAD.encode([251u8; 32]);
        assert_eq!(key.len(), 43);
        assert!(key.contains('-') && key.contains('_'));
        assert_eq!(canonical_offline_key(&key), Some(key));
    }
    #[test]
    fn offline_keys_canonicalize_standard_padding_and_alphabet() {
        let bytes = [251u8; 32];
        let standard = STANDARD.encode(bytes);
        let canonical = URL_SAFE_NO_PAD.encode(bytes);
        assert!(standard.contains('+') && standard.contains('/') && standard.ends_with('='));
        assert_eq!(canonical_offline_key(&standard), Some(canonical.clone()));
        assert_eq!(
            canonical_offline_key(&standard),
            canonical_offline_key(&canonical)
        );
        assert_ne!(
            canonical_offline_key(&canonical),
            canonical_offline_key(&URL_SAFE_NO_PAD.encode([0u8; 32]))
        );
    }
    #[test]
    fn offline_keys_require_exact_key_material() {
        for length in [0, 1, 31, 33, 64] {
            assert_eq!(
                canonical_offline_key(&STANDARD.encode(vec![0u8; length])),
                None
            );
            assert_eq!(
                canonical_offline_key(&URL_SAFE_NO_PAD.encode(vec![0u8; length])),
                None
            );
        }
        for value in ["not-a-key", "!", " ", "💀"] {
            assert_eq!(canonical_offline_key(value), None);
        }
        let key = URL_SAFE_NO_PAD.encode([251u8; 32]);
        for value in [
            format!(" {key}"),
            format!("{key}\n"),
            format!("{key}="),
            key.replace('-', "+"),
        ] {
            assert_eq!(canonical_offline_key(&value), None);
        }
    }
    #[test]
    fn corrupt_metadata_fails_closed_and_never_contains_passwords() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index.json");
        std::fs::write(&path, b"broken").unwrap();
        assert!(read_index(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"broken");
        let mut index = Index::new();
        index.insert(
            "alice".into(),
            Metadata {
                last_used: 1,
                stay_logged_in: true,
            },
        );
        save_index(&path, &index).unwrap();
        assert!(!String::from_utf8(std::fs::read(path).unwrap())
            .unwrap()
            .contains("password"));
    }
}
