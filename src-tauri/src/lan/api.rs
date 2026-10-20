//! SQLite execution for the LAN gateway.
//!
//! Opens the same `ps-cafe.db` file `tauri-plugin-sql` uses
//! (`app_config_dir/ps-cafe.db`; see the plugin's `path_mapper`) with
//! WAL + busy_timeout + foreign_keys, so the desktop app and paired
//! phones can safely share one database file. Hard invariants
//! (`uq_open_day`, `uq_active_session_per_station`) are enforced by the
//! schema itself, so they hold no matter which client writes.

use rusqlite::{Connection, OpenFlags};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// File name shared with the frontend (`Database.load("sqlite:ps-cafe.db")`).
pub const DB_FILE_NAME: &str = "ps-cafe.db";

/// Resolve the desktop database file under the app config dir.
pub fn db_path(app_config_dir: &std::path::Path) -> PathBuf {
    app_config_dir.join(DB_FILE_NAME)
}

/// Open the shared database with concurrency-safe settings.
pub fn open_shared(path: &std::path::Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_FULL_MUTEX,
    )
    .map_err(|e| format!("open db: {e}"))?;
    // FULL_MUTEX above makes the connection thread-safe; a plain
    // `Mutex<Connection>` guard additionally serializes statement use.
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;",
    )
    .map_err(|e| format!("pragmas: {e}"))?;
    Ok(conn)
}

/// JSON-compatible parameter value (mirrors the plugin's binding rules).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum Param {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Text(String),
}

/// A row decoded as an ordered object: duplicate column names are kept
/// with positional suffixes so no data is silently dropped.
pub type RowObject = serde_json::Map<String, serde_json::Value>;

fn param_values(params: &[Param]) -> Vec<rusqlite::types::Value> {
    use rusqlite::types::Value;
    params
        .iter()
        .map(|p| match p {
            Param::Null => Value::Null,
            Param::Bool(b) => Value::Integer(if *b { 1 } else { 0 }),
            Param::Int(i) => Value::Integer(*i),
            Param::Float(f) => Value::Real(*f),
            Param::Text(s) => Value::Text(s.clone()),
        })
        .collect()
}

fn exec_stmt(params: &[Param], stmt: &mut rusqlite::Statement) -> Result<u64, String> {
    // `Statement::execute` returns the last-statement change count.
    stmt.execute(rusqlite::params_from_iter(param_values(params)))
        .map(|n| n as u64)
        .map_err(|e| map_error(&e))
}

/// Map SQLite errors to the same `code` vocabulary the TypeScript
/// `repoCode()` helper parses (`CONSTRAINT` on UNIQUE violations).
pub fn map_error(e: &rusqlite::Error) -> String {
    match e {
        rusqlite::Error::SqliteFailure(f, Some(msg))
            if f.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            format!("CONSTRAINT: {msg}")
        }
        other => format!("{other}"),
    }
}


/// Thread-safe handle: one connection guarded by a mutex. SQLite
/// serializes the writes; readers use WAL snapshots.
#[derive(Debug, Clone)]
pub struct GatewayDb {
    conn: Arc<Mutex<Connection>>,
}

impl GatewayDb {
    pub fn open(path: &std::path::Path) -> Result<Self, String> {
        Ok(Self {
            conn: Arc::new(Mutex::new(open_shared(path)?)),
        })
    }

    /// Run a validated SELECT and return rows as JSON objects.
    pub fn select(&self, sql: &str, params: &[Param]) -> Result<Vec<RowObject>, String> {
        let conn = self.conn.lock().map_err(|_| "db lock poisoned".to_string())?;
        let mut stmt = conn.prepare(sql).map_err(|e| map_error(&e))?;
        let names: Vec<String> = stmt
            .column_names()
            .into_iter()
            .map(|s| s.to_string())
            .collect();
        let width = names.len();
        let rows = stmt
            .query_map(rusqlite::params_from_iter(param_values(params)), |row| {
                let mut vals = Vec::with_capacity(width);
                for i in 0..width {
                    vals.push(row.get::<_, rusqlite::types::Value>(i)?);
                }
                Ok(vals)
            })
            .map_err(|e| map_error(&e))?;
        let mut out = Vec::new();
        for vals in rows {
            let vals = vals.map_err(|e| map_error(&e))?;
            let mut obj = RowObject::new();
            for (i, name) in names.iter().enumerate() {
                let key = if obj.contains_key(name) {
                    format!("{name}#{i}")
                } else {
                    name.clone()
                };
                obj.insert(key, value_to_json(vals[i].clone()));
            }
            out.push(obj);
        }
        Ok(out)
    }

    /// Run a validated INSERT/UPDATE/DELETE. Returns affected rows.
    pub fn execute(&self, sql: &str, params: &[Param]) -> Result<u64, String> {
        let conn = self.conn.lock().map_err(|_| "db lock poisoned".to_string())?;
        let mut stmt = conn.prepare(sql).map_err(|e| map_error(&e))?;
        exec_stmt(params, &mut stmt)
    }
}

fn value_to_json(v: rusqlite::types::Value) -> serde_json::Value {
    use rusqlite::types::Value;
    match v {
        Value::Null => serde_json::Value::Null,
        Value::Integer(i) => serde_json::json!(i),
        Value::Real(f) => serde_json::json!(f),
        Value::Text(s) => serde_json::Value::String(s),
        Value::Blob(_) => serde_json::Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memdb() -> GatewayDb {
        let conn = Connection::open_in_memory().expect("memdb");
        conn.execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT, n INTEGER);",
        )
        .expect("schema");
        GatewayDb {
            conn: Arc::new(Mutex::new(conn)),
        }
    }

    #[test]
    fn roundtrip() {
        let db = memdb();
        db.execute(
            "INSERT INTO t(name, n) VALUES (?, ?)",
            &[Param::Text("a".into()), Param::Int(3)],
        )
        .unwrap();
        let rows = db.select("SELECT id, name, n FROM t ORDER BY id", &[]).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["name"], serde_json::json!("a"));
        assert_eq!(rows[0]["n"], serde_json::json!(3));
    }

    #[test]
    fn constraint_maps_to_code() {
        let db = memdb();
        db.execute(
            "INSERT INTO t(id, name) VALUES (?, ?)",
            &[Param::Int(1), Param::Null],
        )
        .unwrap();
        let err = db
            .execute(
                "INSERT INTO t(id, name) VALUES (?, ?)",
                &[Param::Int(1), Param::Null],
            )
            .unwrap_err();
        assert!(err.starts_with("CONSTRAINT"), "{err}");
    }

    #[test]
    fn db_path_shape() {
        let p = db_path(std::path::Path::new("/cfg"));
        assert_eq!(p, std::path::PathBuf::from("/cfg/ps-cafe.db"));
    }
}
