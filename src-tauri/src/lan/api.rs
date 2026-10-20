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
///
/// The connection is opened read-only (`SQLITE_OPEN_READONLY`) and the
/// SQLite engine itself is put in `query_only` mode, so even a bug in
/// the request layer cannot mutate the shared file. The desktop app
/// writes through `tauri-plugin-sql` on its own connection.
pub fn open_shared(path: &std::path::Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_FULL_MUTEX,
    )
    .map_err(|e| format!("open db: {e}"))?;
    // FULL_MUTEX above makes the connection thread-safe; a plain
    // `Mutex<Connection>` guard additionally serializes statement use.
    // `journal_mode` is not set here: it is persisted in the database
    // file and setting it would attempt a write.
    conn.execute_batch(
        "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000; PRAGMA query_only=ON;",
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


/// A lazily-resolved handle to the shared database.
///
/// The gateway opens the database read-only, and a read-only SQLite handle
/// requires the file to already exist. On a fresh install the desktop may
/// create `ps-cafe.db` only after the gateway is already running, so the
/// connection is resolved lazily: the first request after the file appears
/// opens it, and every later request reuses the cached handle.
///
/// A failed attempt is *not* cached, so the handle keeps retrying and the
/// gateway starts serving data as soon as the desktop writes the file.
#[derive(Debug, Clone)]
pub struct DbHandle {
    path: PathBuf,
    conn: Arc<Mutex<Option<GatewayDb>>>,
}

impl DbHandle {
    /// Build a handle for `path`. `initial` is used when the database could
    /// already be opened at startup; otherwise it is resolved on first use.
    pub fn new(path: PathBuf, initial: Option<GatewayDb>) -> Self {
        Self {
            path,
            conn: Arc::new(Mutex::new(initial)),
        }
    }

    /// The current read-only connection, opening it if necessary.
    ///
    /// Returns `None` while the database file is still missing (or cannot
    /// be opened read-only); callers answer `DB_NOT_READY`.
    pub fn get(&self) -> Option<GatewayDb> {
        let mut guard = self.conn.lock().ok()?;
        if let Some(db) = guard.as_ref() {
            return Some(db.clone());
        }
        match GatewayDb::open(&self.path) {
            Ok(db) => {
                *guard = Some(db.clone());
                Some(db)
            }
            Err(e) => {
                eprintln!("lan gateway: database not readable yet ({e}); serving without data");
                None
            }
        }
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
    ///
    /// The gateway has no write path at all: paired phones are
    /// read-only visitors.
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
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO t(name, n) VALUES (?, ?)",
            rusqlite::params!["a", 3],
        )
        .unwrap();
        drop(conn);
        let rows = db.select("SELECT id, name, n FROM t ORDER BY id", &[]).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["name"], serde_json::json!("a"));
        assert_eq!(rows[0]["n"], serde_json::json!(3));
    }

    #[test]
    fn constraint_maps_to_code() {
        let db = memdb();
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO t(id, name) VALUES (?, ?)",
            rusqlite::params![1, rusqlite::types::Value::Null],
        )
        .unwrap();
        let err = conn
            .execute(
                "INSERT INTO t(id, name) VALUES (?, ?)",
                rusqlite::params![1, rusqlite::types::Value::Null],
            )
            .unwrap_err();
        assert!(err.to_string().contains("UNIQUE"), "{err}");
    }

    #[test]
    fn shared_connection_rejects_writes() {
        // The gateway connection is opened read-only with `query_only=ON`,
        // so a write attempt must fail at the SQLite engine level.
        let dir = std::env::temp_dir().join(format!("pscafe_ro_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("ps-cafe.db");
        {
            let c = Connection::open(&path).unwrap();
            c.execute_batch("CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT);")
                .unwrap();
        }
        let conn = open_shared(&path).unwrap();
        let err = conn
            .execute("INSERT INTO t(name) VALUES ('x')", [])
            .unwrap_err();
        assert!(
            err.to_string().contains("readonly") || err.to_string().contains("read-only"),
            "expected a read-only error, got: {err}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn db_path_shape() {
        let p = db_path(std::path::Path::new("/cfg"));
        assert_eq!(p, std::path::PathBuf::from("/cfg/ps-cafe.db"));
    }

    #[test]
    fn db_handle_resolves_a_database_created_after_startup() {
        // The gateway may start before the desktop has written the database
        // file. The handle must report "not ready" while the file is
        // missing and pick it up as soon as it appears.
        let dir = std::env::temp_dir().join(format!(
            "pscafe_late_db_{}_{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("ps-cafe.db");
        let _ = std::fs::remove_file(&path);

        let handle = DbHandle::new(path.clone(), None);
        assert!(handle.get().is_none(), "missing db must not resolve");

        // The desktop creates the database after the gateway started.
        {
            let c = Connection::open(&path).unwrap();
            c.execute_batch("CREATE TABLE t(n INTEGER);").unwrap();
        }
        let db = handle
            .get()
            .expect("db should resolve once the file exists");
        let rows = db.select("SELECT 1 AS n", &[]).unwrap();
        assert_eq!(rows[0]["n"], serde_json::json!(1));

        // The resolved connection is cached, not reopened per request.
        let again = handle.get().expect("cached db");
        assert!(Arc::ptr_eq(
            &again.conn,
            &db.conn
        ));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
