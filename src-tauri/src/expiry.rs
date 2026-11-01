//! Notifications derive from the authenticated frontend's link events/snapshots.
//! No Rust HTTP polling, second cookie store, or new backend is involved.
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

#[derive(Default)]
pub struct ExpiryNotifications(Mutex<HashSet<(String, String, String)>>);

fn hours_left(expires_at: &str, now: chrono::DateTime<chrono::Utc>) -> Result<Option<i64>, String> {
    let expiry = chrono::DateTime::parse_from_rfc3339(expires_at)
        .map_err(|_| "invalid link expiry timestamp")?;
    let ms = expiry.signed_duration_since(now).num_milliseconds();
    Ok((ms > 0 && ms <= 6 * 60 * 60 * 1000).then(|| (ms + 3_599_999) / 3_600_000))
}

#[tauri::command]
pub fn notify_link_expiry(
    app: tauri::AppHandle,
    state: State<'_, ExpiryNotifications>,
    account_id: String,
    link_id: String,
    expires_at: String,
) -> Result<bool, String> {
    if account_id.is_empty() || account_id.len() > 200 || link_id.is_empty() || link_id.len() > 200
    {
        return Err("account and link identifiers are required".into());
    }
    let Some(hours) = hours_left(&expires_at, chrono::Utc::now())? else {
        return Ok(false);
    };
    let mut seen = state
        .0
        .lock()
        .map_err(|_| "expiry notification lock failed")?;
    let identity = (account_id, link_id.clone(), expires_at);
    if seen.contains(&identity) {
        return Ok(false);
    }
    if seen.len() >= 1000 {
        return Err("expiry notification limit reached; clear on logout".into());
    }
    app.notification()
        .builder()
        .title("Link Expiring Soon")
        .body(format!("A secure link is expiring in about {hours} hours."))
        .show()
        .map_err(|_| "link expiry notification failed")?;
    seen.insert(identity);
    if let Some(main) = app.get_webview_window("main") {
        main.emit(
            "link-expiry-warning",
            serde_json::json!({"linkId": link_id, "hoursLeft": hours}),
        )
        .map_err(|_| "link expiry event failed")?;
    }
    Ok(true)
}

#[tauri::command]
pub fn clear_link_expiry_notifications(
    state: State<'_, ExpiryNotifications>,
) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "expiry notification lock failed")?
        .clear();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn warnings_cover_only_positive_remaining_time_up_to_six_hours() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        assert_eq!(hours_left("2026-01-01T00:01:00Z", now).unwrap(), Some(1));
        assert_eq!(hours_left("2026-01-01T06:00:00Z", now).unwrap(), Some(6));
        assert_eq!(hours_left("2026-01-01T06:00:01Z", now).unwrap(), None);
        assert_eq!(hours_left("2026-01-01T00:00:00Z", now).unwrap(), None);
        assert!(hours_left("bad", now).is_err());
    }
}
