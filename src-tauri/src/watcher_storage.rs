//! Partition local logs by authenticated frontend account ID. This is local
//! account separation, not authentication against a compromised main renderer.
use crate::WatcherLogEntry;
use rusqlite::{params, Connection};

fn account(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 200
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("valid watcher accountId required".into());
    }
    Ok(())
}

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    // Never assign legacy unscoped rows to whichever account signs in first.
    // Leave watcher_logs untouched for explicit, owner-reviewed recovery.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS watcher_account_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        metadata TEXT,
        success INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_watcher_account_id ON watcher_account_logs(account_id, id);",
    )
}

pub fn insert(
    conn: &mut Connection,
    id: &str,
    entry: WatcherLogEntry,
    cap: Option<i64>,
) -> Result<(), String> {
    account(id)?;
    let metadata = entry
        .metadata
        .map(|value| serde_json::to_string(&value))
        .transpose()
        .map_err(|_| "watcher metadata serialization failed")?;
    let tx = conn
        .transaction()
        .map_err(|_| "watcher transaction failed")?;
    tx.execute("INSERT INTO watcher_account_logs (account_id, event_type, ip_address, user_agent, metadata, success, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)", params![id, entry.event_type, entry.ip_address, entry.user_agent, metadata, entry.success, entry.created_at]).map_err(|_| "watcher insert failed")?;
    tx.execute("DELETE FROM watcher_account_logs WHERE account_id = ?1 AND id NOT IN (SELECT id FROM watcher_account_logs WHERE account_id = ?1 ORDER BY id DESC LIMIT ?2)", params![id, cap.unwrap_or(200).clamp(1, 1000)]).map_err(|_| "watcher prune failed")?;
    tx.commit().map_err(|_| "watcher commit failed".into())
}

pub fn get(
    conn: &Connection,
    id: &str,
    limit: Option<i64>,
) -> Result<Vec<WatcherLogEntry>, String> {
    account(id)?;
    let mut stmt = conn.prepare("SELECT id, event_type, ip_address, user_agent, metadata, success, created_at FROM watcher_account_logs WHERE account_id = ?1 ORDER BY id DESC LIMIT ?2").map_err(|_| "watcher query preparation failed")?;
    let rows = stmt
        .query_map(params![id, limit.unwrap_or(200).clamp(1, 1000)], |row| {
            let metadata: Option<String> = row.get(4)?;
            Ok(WatcherLogEntry {
                id: row.get(0)?,
                event_type: row.get(1)?,
                ip_address: row.get(2)?,
                user_agent: row.get(3)?,
                metadata: metadata.and_then(|value| serde_json::from_str(&value).ok()),
                success: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|_| "watcher query failed")?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| "watcher result read failed".into())
}

pub fn clear(conn: &Connection, id: &str) -> Result<(), String> {
    account(id)?;
    conn.execute(
        "DELETE FROM watcher_account_logs WHERE account_id = ?1",
        [id],
    )
    .map_err(|_| "watcher clear failed")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn log() -> WatcherLogEntry {
        WatcherLogEntry {
            id: None,
            event_type: "LOGIN".into(),
            ip_address: None,
            user_agent: None,
            metadata: None,
            success: true,
            created_at: "2026-01-01T00:00:00Z".into(),
        }
    }
    #[test]
    fn read_prune_and_clear_are_account_scoped() {
        let mut conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        insert(&mut conn, "alice", log(), Some(1)).unwrap();
        insert(&mut conn, "bob", log(), Some(1)).unwrap();
        insert(&mut conn, "alice", log(), Some(1)).unwrap();
        assert_eq!(get(&conn, "alice", None).unwrap().len(), 1);
        assert_eq!(get(&conn, "bob", None).unwrap().len(), 1);
        clear(&conn, "alice").unwrap();
        assert!(get(&conn, "alice", None).unwrap().is_empty());
        assert_eq!(get(&conn, "bob", None).unwrap().len(), 1);
        assert!(get(&conn, "", None).is_err());
        assert!(clear(&conn, "x OR 1=1").is_err());
    }
    #[test]
    fn legacy_rows_are_not_attributed_to_a_new_account() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE watcher_logs (id INTEGER); INSERT INTO watcher_logs VALUES (1);",
        )
        .unwrap();
        init(&conn).unwrap();
        assert!(get(&conn, "alice", None).unwrap().is_empty());
        assert_eq!(
            conn.query_row("SELECT count(*) FROM watcher_logs", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
}
