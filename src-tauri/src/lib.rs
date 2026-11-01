use discord_rich_presence::activity;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::TcpStream;
use std::sync::Mutex;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, PhysicalPosition, Position, State};
use tauri_plugin_notification::NotificationExt;

mod atomic_file;
mod credentials;
mod deb_update;
mod expiry;
mod watcher_storage;
pub mod close_policy;
use credentials::{
    offline_vault_get_key, offline_vault_set_key, secure_store_get, secure_store_list,
    secure_store_remove, secure_store_upsert,
};
use deb_update::{install_linux_deb_update, prepare_linux_deb_update};
use expiry::{clear_link_expiry_notifications, notify_link_expiry};
mod discord_rpc;
mod single_instance;

use chrono::Local;
use sha2::{Digest, Sha256};

const DISCORD_RP_ACTIVITY_NAME: &str = "Mourn";
const DISCORD_RP_LARGE_IMAGE: &str = "mourn_logo";
const DISCORD_RP_LARGE_TEXT: &str = "MOURN";
const DISCORD_RP_SMALL_IMAGE: &str = "mourn_sigil";
const DISCORD_RP_SMALL_TEXT: &str = "vita nova";
const DISCORD_RP_BUTTON_LABEL: &str = "new life";
const DISCORD_RP_BUTTON_URL: &str = "https://mourn.bio/register";

// =============================================
// Stored minimized-to-tray state (Rust-side mirror)
// =============================================
/// Managed "stay minimized (close to tray)" preference. Kept in Rust so the
/// `on_window_event` close handler can decide between hiding (background) and
/// actually closing the window, independent of the JS side — a robust net for
/// OS-level close gestures (Alt+F4 / WM close) in addition to the custom title
/// bar. Defaults OFF (window closes normally).
#[derive(Default)]
struct StayMinimizedState(Mutex<bool>);

#[tauri::command]
fn set_stay_minimized(state: State<'_, StayMinimizedState>, enabled: bool) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|e| format!("stay-minimized lock: {e}"))?;
    *guard = enabled;
    Ok(())
}

fn restore_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is unavailable".to_string())?;

    window
        .show()
        .map_err(|e| format!("show main window: {e}"))?;
    window
        .unminimize()
        .map_err(|e| format!("restore main window: {e}"))?;
    window
        .set_focus()
        .map_err(|e| format!("focus main window: {e}"))
}

fn hide_tray_menu(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("tray-menu") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn tray_open(app: tauri::AppHandle) -> Result<(), String> {
    hide_tray_menu(&app);
    restore_main_window(&app)
}

#[tauri::command]
fn tray_navigate(app: tauri::AppHandle, route: String) -> Result<(), String> {
    const ALLOWED_ROUTES: [&str; 4] = ["/chains", "/archives", "/graveyard", "/dashboard"];

    if !ALLOWED_ROUTES.contains(&route.as_str()) {
        return Err("unsupported tray navigation route".to_string());
    }

    hide_tray_menu(&app);
    restore_main_window(&app)?;

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is unavailable".to_string())?;
    window
        .emit("tray-navigate", route)
        .map_err(|e| format!("emit tray navigation: {e}"))
}

#[tauri::command]
fn tray_dismiss(app: tauri::AppHandle) {
    hide_tray_menu(&app);
}

#[tauri::command]
fn tray_exit(app: tauri::AppHandle) {
    app.exit(0);
}

#[derive(Default)]
struct DiscordRpcState {
    client: Mutex<Option<discord_rpc::DiscordIpc>>,
}

fn build_discord_activity(state: String, details: String) -> activity::Activity<'static> {
    let state = if state.trim().is_empty() {
        "vita nova".to_string()
    } else {
        state
    };

    activity::Activity::new()
        .name(DISCORD_RP_ACTIVITY_NAME)
        .state(state)
        .details(details)
        .activity_type(activity::ActivityType::Playing)
        .status_display_type(activity::StatusDisplayType::State)
        .assets(
            activity::Assets::new()
                .large_image(DISCORD_RP_LARGE_IMAGE)
                .large_text(DISCORD_RP_LARGE_TEXT)
                .small_image(DISCORD_RP_SMALL_IMAGE)
                .small_text(DISCORD_RP_SMALL_TEXT),
        )
        .buttons(vec![activity::Button::new(
            DISCORD_RP_BUTTON_LABEL,
            DISCORD_RP_BUTTON_URL,
        )])
}

#[tauri::command]
fn start_discord_rpc(
    rpc_state: State<'_, DiscordRpcState>,
    client_id: String,
    state: String,
    details: String,
) -> Result<(), String> {
    let mut guard = rpc_state
        .client
        .lock()
        .map_err(|e| format!("discord rpc lock: {e}"))?;

    if let Some(mut existing) = guard.take() {
        if let Err(err) = existing.close() {
            eprintln!("[discord-rpc] close existing client failed: {err}");
        }
    }

    let mut client = discord_rpc::DiscordIpc::new(client_id.as_str());
    client
        .connect()
        .map_err(|err| format!("discord rpc connect failed: {err}"))?;

    let activity = build_discord_activity(state, details);
    if let Err(err) = client.set_activity(&activity) {
        let _ = client.close();
        return Err(format!("discord rpc activity failed: {err}"));
    }

    *guard = Some(client);
    Ok(())
}

#[tauri::command]
fn stop_discord_rpc(rpc_state: State<'_, DiscordRpcState>) -> Result<(), String> {
    let mut guard = rpc_state
        .client
        .lock()
        .map_err(|e| format!("discord rpc lock: {e}"))?;

    if let Some(mut client) = guard.take() {
        if let Err(err) = client.close() {
            return Err(format!("discord rpc close failed: {err}"));
        }
    }

    Ok(())
}

fn validate_vault_key_name(key_name: &str) -> Result<(), String> {
    if !key_name.starts_with("vault_")
        || key_name.len() > 200
        || !key_name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err("invalid vault key name".to_string());
    }
    Ok(())
}

#[tauri::command]
fn vault_key_set(key_name: String, value: String) -> Result<(), String> {
    validate_vault_key_name(&key_name)?;
    if value.is_empty() || value.len() > 16 * 1024 {
        return Err("invalid vault key value".to_string());
    }
    keyring::Entry::new("mourn-desktop-vault", &key_name)
        .map_err(|_| "OS keychain unavailable")?
        .set_password(&value)
        .map_err(|_| "vault keyring write failed".into())
}

#[tauri::command]
fn vault_key_get(key_name: String) -> Result<Option<String>, String> {
    validate_vault_key_name(&key_name)?;
    match keyring::Entry::new("mourn-desktop-vault", &key_name)
        .map_err(|_| "OS keychain unavailable")?
        .get_password()
    {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("vault keyring read failed".into()),
    }
}

#[tauri::command]
fn vault_key_remove(key_name: String) -> Result<(), String> {
    validate_vault_key_name(&key_name)?;
    match keyring::Entry::new("mourn-desktop-vault", &key_name)
        .map_err(|_| "OS keychain unavailable")?
        .delete_credential()
    {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("vault keyring deletion failed".into()),
    }
}

// =============================================
// Communication Bridge — Rust ↔ TypeScript
// =============================================

/// Placeholder for future C# Ghost Engine sidecar communication.
/// The C# executable should be placed at:
///   src-tauri/binaries/ghost-engine-x86_64-unknown-linux-gnu
/// (adjust the triple for your target OS)
#[derive(Debug, Serialize, Deserialize)]
pub struct GhostPayload {
    pub command: String,
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GhostResponse {
    pub success: bool,
    pub message: String,
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CertPinResult {
    pub ok: bool,
    pub actual_sha256: String,
    pub expected_sha256: String,
}

fn constant_time_hex_eq(a_hex: &str, b_hex: &str) -> bool {
    let a = a_hex.trim().to_lowercase();
    let b = b_hex.trim().to_lowercase();
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.as_bytes().iter().zip(b.as_bytes().iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn verify_backend_pin_sync(url: &str, expected_sha256: &str) -> Result<CertPinResult, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalid url: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("certificate pinning requires an https URL".to_string());
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| "missing host in pinned url".to_string())?
        .to_string();
    let port = parsed.port_or_known_default().unwrap_or(443);

    let tcp = TcpStream::connect((host.as_str(), port))
        .map_err(|e| format!("tcp connect failed: {e}"))?;
    let connector = native_tls::TlsConnector::builder()
        .build()
        .map_err(|e| format!("tls connector failed: {e}"))?;
    let tls = connector
        .connect(host.as_str(), tcp)
        .map_err(|e| format!("tls handshake failed: {e}"))?;
    let cert = tls
        .peer_certificate()
        .map_err(|e| format!("peer certificate read failed: {e}"))?
        .ok_or_else(|| "no peer certificate presented".to_string())?;
    let cert_der = cert
        .to_der()
        .map_err(|e| format!("certificate der conversion failed: {e}"))?;
    let digest = Sha256::digest(&cert_der);
    let actual_sha256 = hex::encode(digest);
    let ok = constant_time_hex_eq(&actual_sha256, expected_sha256);

    Ok(CertPinResult {
        ok,
        actual_sha256,
        expected_sha256: expected_sha256.to_lowercase(),
    })
}

#[tauri::command]
async fn send_to_ghost_engine(payload: GhostPayload) -> Result<GhostResponse, String> {
    // TODO: Once the C# sidecar is ready, launch it here via tauri::api::process::Command
    // For now, return a placeholder acknowledging the command.
    Ok(GhostResponse {
        success: true,
        message: format!(
            "ghost-engine bridge ready — received command '{}'",
            payload.command
        ),
        data: payload.data,
    })
}

/// System status check — reports basic hardware health info
///
/// The renderer reads this in camelCase (`hardwareAccelerationPreference`,
/// `graphicsToggleSupported`). Without `rename_all` serde emitted snake_case,
/// so both fields arrived as `undefined` — which made the hardware-acceleration
/// toggle always render "off" AND permanently disabled (`!undefined === true`),
/// i.e. "the toggle won't let me change it".
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatus {
    pub platform: String,
    pub arch: String,
    /// None means unknown; a host preference cannot prove hardware acceleration.
    pub gpu_acceleration: Option<bool>,
    pub hardware_acceleration_preference: bool,
    pub graphics_toggle_supported: bool,
    pub estimated_ram_mb: u64,
    pub tauri_version: String,
    /// Linux only: true when running from an AppImage (the `$APPIMAGE` runtime
    /// env var is set). Tauri's Linux updater can ONLY install into an AppImage,
    /// so the updater uses this to avoid attempting an install that is
    /// guaranteed to fail on a .deb/native install.
    pub is_appimage: bool,
    /// Linux only: true when running inside a Flatpak sandbox (the runtime
    /// creates `/.flatpak-info`). The in-app updater cannot write `/app`, and
    /// `flatpak update` already handles updates, so the updater must stand down
    /// entirely — otherwise every launch shows a permanent "update failed".
    pub is_flatpak: bool,
}

fn graphics_preference_path() -> Option<std::path::PathBuf> {
    dirs::config_dir().map(|dir| dir.join("bio.mourn.desktop").join("graphics-mode"))
}

fn hardware_acceleration_preference() -> bool {
    graphics_preference_path()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|value| value.trim() != "software")
        .unwrap_or(true)
}

/// Apply Mourn's persisted graphics preference before the platform webview is
/// created. Hardware mode leaves selection to the OS/webview/driver; it never
/// overrides safety blocklists or forces a discrete GPU.
pub fn apply_graphics_preference() {
    let software_opt_in = !hardware_acceleration_preference()
        || std::env::var("MOURN_WEBKIT_SOFTWARE_RENDER")
            .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
            .unwrap_or(false);
    if !software_opt_in {
        return;
    }

    #[cfg(target_os = "linux")]
    {
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            std::env::set_var("MOURN_MANAGED_WEBKIT_DMABUF", "1");
        }
        if std::env::var("WEBKIT_DISABLE_COMPOSITING_MODE").is_err() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
            std::env::set_var("MOURN_MANAGED_WEBKIT_COMPOSITING", "1");
        }
    }

    #[cfg(target_os = "windows")]
    {
        const FLAG: &str = "--disable-gpu";
        let existing = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        if !existing.split_whitespace().any(|item| item == FLAG) {
            let value = if existing.trim().is_empty() {
                FLAG.to_string()
            } else {
                format!("{} {}", existing.trim(), FLAG)
            };
            std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", value);
            std::env::set_var("MOURN_MANAGED_WEBVIEW2_DISABLE_GPU", "1");
        }
    }
}

#[tauri::command]
fn set_hardware_acceleration_preference(enabled: bool) -> Result<(), String> {
    if cfg!(target_os = "macos") {
        return Err(
            "WKWebView does not expose a supported per-app acceleration toggle".to_string(),
        );
    }
    let path = graphics_preference_path().ok_or("platform config directory unavailable")?;
    let parent = path
        .parent()
        .ok_or("graphics preference directory unavailable")?;
    std::fs::create_dir_all(parent).map_err(|e| format!("create graphics config: {e}"))?;
    std::fs::write(path, if enabled { "hardware" } else { "software" })
        .map_err(|e| format!("write graphics preference: {e}"))?;

    // Tauri's relaunch inherits this process environment. Remove only flags
    // that this running Mourn process applied, otherwise switching back to
    // hardware mode would remain stuck in software rendering for one launch.
    if enabled {
        #[cfg(target_os = "linux")]
        {
            if std::env::var("MOURN_MANAGED_WEBKIT_DMABUF").as_deref() == Ok("1") {
                std::env::remove_var("WEBKIT_DISABLE_DMABUF_RENDERER");
                std::env::remove_var("MOURN_MANAGED_WEBKIT_DMABUF");
            }
            if std::env::var("MOURN_MANAGED_WEBKIT_COMPOSITING").as_deref() == Ok("1") {
                std::env::remove_var("WEBKIT_DISABLE_COMPOSITING_MODE");
                std::env::remove_var("MOURN_MANAGED_WEBKIT_COMPOSITING");
            }
        }
        #[cfg(target_os = "windows")]
        if std::env::var("MOURN_MANAGED_WEBVIEW2_DISABLE_GPU").as_deref() == Ok("1") {
            const FLAG: &str = "--disable-gpu";
            let retained = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS")
                .unwrap_or_default()
                .split_whitespace()
                .filter(|item| *item != FLAG)
                .collect::<Vec<_>>()
                .join(" ");
            if retained.is_empty() {
                std::env::remove_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS");
            } else {
                std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", retained);
            }
            std::env::remove_var("MOURN_MANAGED_WEBVIEW2_DISABLE_GPU");
        }
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopTimezone {
    pub name: String,
    pub offset_minutes: i32,
}

#[tauri::command]
async fn get_system_status() -> Result<SystemStatus, String> {
    use std::env;

    // Rough RAM estimate from sysinfo-style data (portable)
    let ram_mb = {
        #[cfg(target_os = "linux")]
        {
            // Read /proc/meminfo for total RAM
            std::fs::read_to_string("/proc/meminfo")
                .ok()
                .and_then(|info| {
                    info.lines()
                        .find(|l| l.starts_with("MemTotal:"))
                        .and_then(|l| {
                            l.split_whitespace()
                                .nth(1)
                                .and_then(|v| v.parse::<u64>().ok())
                        })
                        .map(|kb| kb / 1024)
                })
                .unwrap_or(0)
        }
        #[cfg(not(target_os = "linux"))]
        {
            0u64
        }
    };

    // WebView2/WebKit may fall back to software because of drivers or policy.
    // Only report the explicit Linux opt-out; never infer GPU usage from its absence.
    let gpu_acceleration = if cfg!(target_os = "linux")
        && env::var("WEBKIT_DISABLE_COMPOSITING_MODE").as_deref() == Ok("1")
    {
        Some(false)
    } else {
        None
    };

    Ok(SystemStatus {
        platform: env::consts::OS.to_string(),
        arch: env::consts::ARCH.to_string(),
        gpu_acceleration,
        hardware_acceleration_preference: hardware_acceleration_preference(),
        graphics_toggle_supported: !cfg!(target_os = "macos"),
        estimated_ram_mb: ram_mb,
        tauri_version: "2.x".to_string(),
        // `$APPIMAGE` is exported by the AppImage runtime itself, so its
        // presence is the reliable "am I an AppImage?" signal on Linux. On
        // Windows the field is always false and the updater ignores it.
        is_appimage: env::var("APPIMAGE").is_ok(),
        // The Flatpak runtime creates /.flatpak-info inside the sandbox.
        is_flatpak: deb_update::is_flatpak(),
    })
}

#[tauri::command]
async fn get_desktop_timezone() -> Result<DesktopTimezone, String> {
    let now = Local::now();
    let offset_minutes = now.offset().local_minus_utc() / 60;
    let name = std::env::var("TZ").unwrap_or_else(|_| now.format("%Z").to_string());

    Ok(DesktopTimezone {
        name,
        offset_minutes,
    })
}

// =============================================
// Watcher — Local Security Log (SQLite via rusqlite)
// =============================================

/// Managed state wrapping the SQLite connection.
pub struct WatcherDb(pub Mutex<rusqlite::Connection>);

/// A single watcher log entry stored locally in SQLite.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WatcherLogEntry {
    pub id: Option<i64>,
    pub event_type: String,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub success: bool,
    pub created_at: String, // ISO-8601 string
}

/// Insert a log into the account-scoped local watcher table.
/// Automatically prunes entries exceeding `max_entries` (FIFO).
#[tauri::command]
fn watcher_insert_log(
    state: tauri::State<'_, WatcherDb>,
    entry: WatcherLogEntry,
    max_entries: Option<i64>,
    account_id: String,
) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| format!("lock: {e}"))?;

    watcher_storage::insert(&mut conn, &account_id, entry, max_entries)
}

/// Return local watcher logs (newest first), up to `limit`.
#[tauri::command]
fn watcher_get_logs(
    state: tauri::State<'_, WatcherDb>,
    limit: Option<i64>,
    account_id: String,
) -> Result<Vec<WatcherLogEntry>, String> {
    let conn = state.0.lock().map_err(|e| format!("lock: {e}"))?;
    watcher_storage::get(&conn, &account_id, limit)
}

/// Delete the selected account's local watcher logs only.
#[tauri::command]
fn watcher_clear_logs(
    state: tauri::State<'_, WatcherDb>,
    account_id: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| format!("lock: {e}"))?;
    watcher_storage::clear(&conn, &account_id)
}

// =============================================
// Chains & Links — Local Encryption Key Store
// =============================================

/// Managed state for local link encryption keys.
/// Maps chat_id → (key_bytes_hex, is_anchored).
pub struct LinkKeyStore(pub Mutex<HashMap<String, LinkKeyEntry>>);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkKeyEntry {
    pub chat_id: String,
    pub key_hex: String,
    pub is_anchored: bool,
    pub created_at: String,
}

/// Generate a local encryption key for a chat link.
/// If `anchor` is true, the key is marked as permanent.
#[tauri::command]
fn establish_secure_link(
    state: tauri::State<'_, LinkKeyStore>,
    chat_id: String,
    anchor: bool,
) -> Result<LinkKeyEntry, String> {
    use std::time::SystemTime;

    let mut store = state.0.lock().map_err(|e| format!("lock: {e}"))?;

    // Generate 256-bit random key
    let mut key_bytes = [0u8; 32];
    getrandom::getrandom(&mut key_bytes).map_err(|e| format!("rng: {e}"))?;
    let key_hex = hex::encode(key_bytes);

    let created_at = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| {
            chrono::DateTime::from_timestamp(d.as_secs() as i64, 0)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default()
        })
        .unwrap_or_default();

    let entry = LinkKeyEntry {
        chat_id: chat_id.clone(),
        key_hex,
        is_anchored: anchor,
        created_at,
    };

    store.insert(chat_id, entry.clone());
    Ok(entry)
}

/// Mark a link's local key as permanently anchored.
#[tauri::command]
fn anchor_link(state: tauri::State<'_, LinkKeyStore>, chat_id: String) -> Result<(), String> {
    let mut store = state.0.lock().map_err(|e| format!("lock: {e}"))?;

    match store.get_mut(&chat_id) {
        Some(entry) => {
            entry.is_anchored = true;
            Ok(())
        }
        None => Err(format!("No local key found for chat_id: {chat_id}")),
    }
}

/// Return the time remaining (in milliseconds) for a link given its expiry timestamp.
#[tauri::command]
fn get_link_expiry(expires_at: Option<String>) -> Result<serde_json::Value, String> {
    match expires_at {
        None => Ok(serde_json::json!({ "ms_remaining": -1 })), // No expiry (anchored)
        Some(ts) => {
            let expiry =
                chrono::DateTime::parse_from_rfc3339(&ts).map_err(|e| format!("parse: {e}"))?;
            let now = chrono::Utc::now();
            let remaining = expiry.signed_duration_since(now);
            let ms = remaining.num_milliseconds().max(0);
            Ok(serde_json::json!({ "ms_remaining": ms }))
        }
    }
}

/// Initialise the watcher SQLite database in the app data directory.
fn init_watcher_db(app: &tauri::App) -> Result<rusqlite::Connection, Box<dyn std::error::Error>> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    std::fs::create_dir_all(&app_dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&app_dir, std::fs::Permissions::from_mode(0o700))?;
    }

    let db_path = app_dir.join("watcher.db");
    let conn = rusqlite::Connection::open(&db_path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&db_path, std::fs::Permissions::from_mode(0o600))?;
    }

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS watcher_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            metadata TEXT,
            success INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_watcher_created ON watcher_logs(created_at);",
    )?;

    watcher_storage::init(&conn)?;
    Ok(conn)
}

// =============================================
// Taskbar Badge
// =============================================

/// Set (or clear) the taskbar badge count.
/// Keep the native window title blank because the app renders its own title bar.
#[tauri::command]
fn set_badge_count(app: tauri::AppHandle, count: u32) -> Result<(), String> {
    // Update window title to show badge count
    if let Some(window) = app.get_webview_window("main") {
        let _ = count;
        window.set_title("").map_err(|e| format!("title: {e}"))?;
    }

    // On Linux, also update system tray tooltip to show unread count
    #[cfg(target_os = "linux")]
    {
        if let Some(tray) = app.tray_by_id("main") {
            let tooltip = if count > 0 {
                format!("Mourn ({} unread)", count)
            } else {
                "Mourn".to_string()
            };
            let _ = tray.set_tooltip(Some(&tooltip));
        }
    }

    Ok(())
}

// =============================================
// Application Entry Point
// =============================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // (No-op) Do not modify WEBKIT_DISABLE_COMPOSITING_MODE here; keep the
    // WebKit runtime behavior controlled by the host environment and package
    // configuration so we don't inadvertently disable WebRTC features.

    // ---------------------------------------------------------------------
    // Single-instance guard — MUST run before the window is built.
    //
    // A second launch must raise the window that is already running instead of
    // starting a competing process. On Linux the app is an uninstalled AppImage
    // with no launcher entry a desktop can use to restore a minimized window,
    // so relaunching is the user's only recovery — and it used to spawn a
    // second process that never surfaced the minimized window while contending
    // for the same vault SQLite file and keyring entry. See single_instance.rs.
    // ---------------------------------------------------------------------
    let instance = single_instance::claim();
    if matches!(instance, single_instance::Claim::Secondary) {
        // Another instance owns the guard and has been asked to show itself.
        return;
    }
    let guard_listener = match instance {
        single_instance::Claim::Primary(listener) => Some(listener),
        _ => None,
    };

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init());

    // Release builds always ship with the signed updater plugin enabled.
    // Debug/dev keeps it opt-in so local runs don't require production updater
    // keys/config unless explicitly requested.
    let enable_updater = !deb_update::is_flatpak()
        && (!cfg!(debug_assertions)
            || std::env::var("MOURN_ENABLE_UPDATER")
                .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
                .unwrap_or(false));

    if enable_updater {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            send_to_ghost_engine,
            get_system_status,
            set_hardware_acceleration_preference,
            get_desktop_timezone,
            secure_store_upsert,
            secure_store_get,
            secure_store_list,
            secure_store_remove,
            offline_vault_get_key,
            offline_vault_set_key,
            set_stay_minimized,
            tray_open,
            tray_navigate,
            tray_dismiss,
            tray_exit,
            vault_key_set,
            vault_key_get,
            vault_key_remove,
            start_discord_rpc,
            stop_discord_rpc,
            install_linux_deb_update,
            prepare_linux_deb_update,
            notify_link_expiry,
            clear_link_expiry_notifications,
            watcher_insert_log,
            watcher_get_logs,
            watcher_clear_logs,
            establish_secure_link,
            anchor_link,
            get_link_expiry,
            set_badge_count
        ])
        .manage(expiry::ExpiryNotifications::default())
        .manage(StayMinimizedState::default())
        .manage(DiscordRpcState::default())
        .on_window_event(|window, event| {
            if window.label() == "tray-menu" {
                match event {
                    tauri::WindowEvent::Focused(false) => {
                        let _ = window.hide();
                    }
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    _ => {}
                }
                return;
            }

            // Closing `main` ends the application on every platform.
            //
            // `main` and `tray-menu` are both real webview windows, so destroying
            // `main` alone would leave the runtime alive with only the hidden tray
            // window: the process keeps running (single-instance listener, watcher
            // SQLite handle, tray) with no window and no way to get one back, which
            // is the reported Linux zombie. The decision itself lives in
            // close_policy (unit-tested); this is the effect.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let stay = !cfg!(target_os = "linux")
                    && window
                        .try_state::<StayMinimizedState>()
                        .map(|state| state.0.lock().map(|guard| *guard).unwrap_or(false))
                        .unwrap_or(false);
                let request = close_policy::CloseRequest {
                    label: close_policy::window_role(window.label()),
                    stay_minimized: stay,
                    explicit: false,
                };
                match request.decide() {
                    close_policy::CloseAction::HideWindow => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    close_policy::CloseAction::ExitApplication => {
                        // Keep the window (and the tray) until the event loop exits,
                        // so the exit is a clean application quit, not a half-torn
                        // down window tree that leaves the runtime waiting.
                        api.prevent_close();
                        window.app_handle().exit(0);
                    }
                    _ => {}
                }
            }
        })
        .setup(move |app| {
            // Optional strict certificate pin enforcement for backend API endpoint.
            // Enable by setting BOTH:
            // - PINNED_BACKEND_URL=https://your-backend
            // - PINNED_BACKEND_CERT_SHA256=<sha256_of_leaf_cert_der>
            if let (Ok(url), Ok(pin)) = (
                std::env::var("PINNED_BACKEND_URL"),
                std::env::var("PINNED_BACKEND_CERT_SHA256"),
            ) {
                let pin_result = verify_backend_pin_sync(&url, &pin)
                    .map_err(|e| format!("certificate pin verification failed: {e}"))?;
                if !pin_result.ok {
                    return Err(format!(
                        "certificate pin mismatch for {}. expected {}, got {}",
                        url, pin_result.expected_sha256, pin_result.actual_sha256,
                    )
                    .into());
                }
            }

            // Initialise watcher SQLite database
            let conn = init_watcher_db(app).map_err(|e| format!("watcher db init: {e}"))?;
            app.manage(WatcherDb(Mutex::new(conn)));

            // Initialise link key store (in-memory)
            app.manage(LinkKeyStore(Mutex::new(HashMap::new())));

            // Best-effort cleanup of any legacy plaintext-encrypted credential
            // file from a previous build (the fake AES scheme has been removed;
            // real secrets now live in the OS keychain).
            if let Ok(dir) = app.path().app_data_dir() {
                let _ = std::fs::remove_file(dir.join("secure_accounts.enc"));
                let _ = std::fs::remove_file(dir.join("secure_accounts.enc.corrupt"));
            }

            // Request notification permission up front (best-effort)
            let _ = app.handle().notification().request_permission();

            // Assign the bundled icon explicitly so Windows consistently uses it
            // for the main window (taskbar/Alt+Tab) and the notification area.
            let app_icon = app
                .default_window_icon()
                .cloned()
                .ok_or("bundled application icon is unavailable")?;
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(app_icon.clone())?;
            }

            let app_handle = app.handle().clone();
            let tray = TrayIconBuilder::with_id("main")
                .icon(app_icon)
                .tooltip("Mourn")
                .show_menu_on_left_click(false)
                .on_tray_icon_event(move |_tray, event: TrayIconEvent| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } => {
                        hide_tray_menu(&app_handle);
                        if let Err(err) = restore_main_window(&app_handle) {
                            eprintln!("[Tray] Failed to restore main window: {err}");
                        }
                    }
                    TrayIconEvent::Click {
                        button: MouseButton::Right,
                        button_state: MouseButtonState::Up,
                        position,
                        ..
                    } => {
                        if let Some(window) = app_handle.get_webview_window("tray-menu") {
                            let scale = window.scale_factor().unwrap_or(1.0);
                            let width = (264.0 * scale).round() as i32;
                            let height = (376.0 * scale).round() as i32;
                            let click_x = position.x.round() as i32;
                            let click_y = position.y.round() as i32;
                            let mut x = click_x - width;
                            let mut y = click_y - height;

                            if let Ok(monitors) = window.available_monitors() {
                                if let Some(monitor) = monitors.iter().find(|monitor| {
                                    let origin = monitor.position();
                                    let size = monitor.size();
                                    click_x >= origin.x
                                        && click_x < origin.x + size.width as i32
                                        && click_y >= origin.y
                                        && click_y < origin.y + size.height as i32
                                }) {
                                    let origin = monitor.position();
                                    let size = monitor.size();
                                    let right = origin.x + size.width as i32;
                                    let bottom = origin.y + size.height as i32;

                                    if x < origin.x {
                                        x = click_x;
                                    }
                                    if y < origin.y {
                                        y = click_y;
                                    }
                                    x = x.clamp(origin.x, (right - width).max(origin.x));
                                    y = y.clamp(origin.y, (bottom - height).max(origin.y));
                                }
                            }

                            let _ = window
                                .set_position(Position::Physical(PhysicalPosition::new(x, y)));
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)
                .ok();

            if tray.is_none() {
                eprintln!("[Tray] Failed to initialize system tray");
            }

            // Serve the single-instance guard for the rest of the process's
            // life: a later launch connects, and we present this window instead
            // of letting a second process start. This is the recovery path when
            // a desktop cannot restore the minimized window itself.
            if let Some(listener) = guard_listener {
                let raise_handle = app.handle().clone();
                single_instance::spawn_raise_server(listener, move || {
                    if let Err(err) = restore_main_window(&raise_handle) {
                        eprintln!("[SingleInstance] Failed to raise main window: {err}");
                    }
                });
            }

            // PageLoadEvent::Finished may never arrive when WebKitGTK or a GPU
            // process stalls. Never leave users with an invisible live process.
            let fallback_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                if let Some(window) = fallback_handle.get_webview_window("main") {
                    if window.is_visible().ok() != Some(true) {
                        if let Err(error) = window.show() {
                            eprintln!(
                                "[Window] Startup fallback failed to show main window: {error}"
                            );
                        }
                    }
                }
            });
            Ok(())
        })
        .on_page_load(|webview, payload| {
            // Show only the main window after its first paint. The tray launcher
            // must remain hidden until a right-click on the notification icon.
            if webview.label() == "main"
                && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
            {
                let window = webview.window();
                // Small delay to let the first paint flush
                let win = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(80));
                    let _ = win.show();
                });
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| match event {
            // Do NOT prevent the exit here. The only thing that stops the process
            // at this point is the runtime's own `ControlFlow::Exit`; calling
            // `app.exit(0)` from inside ExitRequested would re-enter the exit path
            // from the event loop that is already unwinding.
            tauri::RunEvent::WindowEvent { label, event, .. } => {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if close_policy::window_role(&label) == close_policy::WindowRole::TrayMenu {
                        // Same dismissal rule as on_window_event; belt and braces for
                        // the case where the per-window handler is superseded.
                        let request = close_policy::CloseRequest {
                            label: close_policy::window_role(&label),
                            stay_minimized: false,
                            explicit: false,
                        };
                        if request.decide() == close_policy::CloseAction::PreventAndHide {
                            api.prevent_close();
                            if let Some(window) = _app.get_webview_window(&label) {
                                let _ = window.hide();
                            }
                        }
                    }
                }
            }
            _ => {}
        });
}
