//! LAN HTTP gateway: routes, auth/host middleware, static assets.
//!
//! Same-origin by construction: the phone loads the app from this server
//! and calls `/api/*` on the same origin, so no CORS headers are ever
//! emitted. Requests whose `Host` does not match the advertised
//! address:port (or loopback for desktop self-checks) are rejected with
//! 421 — this blunts DNS-rebinding attacks.
//!
//! Public (unauthenticated): `/`, static assets, `/api/health`.
//! Authenticated (bearer token): `/api/select`.
//!
//! The gateway is a strictly read-only visitor surface. `/api/execute`
//! always answers `403 READ_ONLY_MODE`; the desktop app performs all
//! writes itself through Tauri, never through this server.

use crate::lan::api::{DbHandle, GatewayDb, Param};
use crate::lan::auth;
use crate::lan::state::LanState;
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use std::sync::Arc;
use std::time::Duration;

/// Default LAN port (unprivileged, unlikely to collide on a cafe PC).
pub const DEFAULT_PORT: u16 = 7741;
/// Maximum JSON body for `/api/*` (statements + params are tiny).
pub const MAX_BODY_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone)]
pub struct AppState {
    pub lan: LanState,
    /// Lazily-resolved read-only handle to the shared database. `None` until
    /// the file exists; the handle re-resolves on every request while it is
    /// missing, so a database created later by the desktop is picked up.
    pub db: DbHandle,
    pub asset_get: AssetGetter,
    pub expected_host_suffix: String,
}

/// The asset-lookup callback behind [`AssetGetter`]: maps a request path
/// (e.g. `/index.html`) to its raw bytes, or `None` when unknown.
pub type AssetLookup = Arc<dyn Fn(&str) -> Option<Vec<u8>> + Send + Sync>;

/// Cloneable asset reader (avoids Debug issues with closures).
#[derive(Clone)]
pub struct AssetGetter(pub AssetLookup);

impl std::fmt::Debug for AssetGetter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AssetGetter(..)")
    }
}

#[derive(Debug, serde::Deserialize)]
struct SqlRequest {
    sql: String,
    #[serde(default)]
    params: Vec<Param>,
}

fn err(status: StatusCode, code: &str) -> Response {
    let body = serde_json::json!({ "ok": false, "error": code }).to_string();
    (status, [(header::CONTENT_TYPE, "application/json")], body).into_response()
}

/// Small internal error shared by the auth/db helpers: `(status, code)`.
/// Keeping it tiny avoids `clippy::result_large_err`; [`err`] builds the
/// actual HTTP response at the handler boundary.
type ApiError = (StatusCode, &'static str);

/// Strict Host validation: the request must target the advertised
/// address:port (phones) or loopback (desktop self-check). Anything else
/// (DNS rebinding, forwarded hosts) is rejected.
async fn host_guard(State(st): State<AppState>, req: Request, next: Next) -> Response {
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let host_no_port = host.split(':').next().unwrap_or("");
    let ok = host == st.expected_host_suffix.to_lowercase()
        || host_no_port == "localhost"
        || host_no_port == "127.0.0.1"
        || host_no_port == "::1";
    if ok {
        next.run(req).await
    } else {
        err(StatusCode::MISDIRECTED_REQUEST, "BAD_HOST")
    }
}

/// Bearer-token check for `/api/select` and `/api/execute`.
/// (`/api/health` and static assets stay public: reachability alone
/// grants nothing — health returns no data and assets are the app shell.)
fn require_auth(st: &AppState, headers: &HeaderMap) -> Result<(), ApiError> {
    let bearer = auth::bearer_from_header(
        headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok()),
    );
    let valid = match bearer {
        Some(b) => st
            .lan
            .inner
            .lock()
            .map(|mut g| g.tokens.validate(&b))
            .unwrap_or(false),
        None => false,
    };
    if valid {
        Ok(())
    } else {
        Err((StatusCode::UNAUTHORIZED, "UNAUTHORIZED"))
    }
}

fn db_or_503(st: &AppState) -> Result<GatewayDb, ApiError> {
    st.db
        .get()
        .ok_or((StatusCode::SERVICE_UNAVAILABLE, "DB_NOT_READY"))
}

/// POST /api/select — validated read-only SQL, returns rows.
async fn handle_select(
    State(st): State<AppState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    if let Err(e) = require_auth(&st, &headers) {
        return err(e.0, e.1);
    }
    let req: SqlRequest = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(_) => return err(StatusCode::BAD_REQUEST, "BAD_JSON"),
    };
    if let Err(code) = crate::lan::sql::validate(&req.sql) {
        return err(StatusCode::FORBIDDEN, &format!("SQL_REJECTED:{code}"));
    }
    let db = match db_or_503(&st) {
        Ok(d) => d,
        Err(e) => return err(e.0, e.1),
    };
    match tokio::task::spawn_blocking(move || db.select(&req.sql, &req.params)).await {
        Ok(Ok(rows)) => json_ok(serde_json::json!({ "rows": rows })),
        Ok(Err(e)) => err(StatusCode::UNPROCESSABLE_ENTITY, &e),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "DB_TASK_FAILED"),
    }
}

/// POST /api/execute — permanently disabled.
///
/// The gateway is a read-only visitor surface: there is no code path,
/// preference, or API that can re-enable writes for LAN clients. The
/// route is kept only so that a stale client receives an explicit
/// `READ_ONLY_MODE` error instead of a confusing 404.
async fn handle_execute() -> Response {
    err(StatusCode::FORBIDDEN, "READ_ONLY_MODE")
}

fn json_ok(v: serde_json::Value) -> Response {
    let mut obj = serde_json::Map::new();
    obj.insert("ok".into(), serde_json::Value::Bool(true));
    if let serde_json::Value::Object(m) = v {
        for (k, val) in m {
            obj.insert(k, val);
        }
    }
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        serde_json::Value::Object(obj).to_string(),
    )
        .into_response()
}

/// GET /api/health — unauthenticated liveness (no data).
async fn handle_health() -> Response {
    json_ok(serde_json::json!({ "service": "ps-cafe-lan", "v": 1 }))
}

fn content_type(path: &str) -> &'static str {
    if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if path.ends_with(".js") {
        "text/javascript; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".ico") {
        "image/x-icon"
    } else if path.ends_with(".json") {
        "application/json"
    } else if path.ends_with(".woff2") {
        "font/woff2"
    } else if path.ends_with(".woff") {
        "font/woff"
    } else {
        "application/octet-stream"
    }
}

/// Serve the embedded frontend. Unknown paths fall back to `index.html`
/// (the app uses hash routing). The served `index.html` gets the
/// `window.__PSCAFE_LAN__` marker injected so the frontend knows it runs
/// as a paired phone client (HTTP transport) rather than desktop Tauri.
async fn handle_asset(State(st): State<AppState>, req: Request) -> Response {
    let mut path = req.uri().path().to_string();
    if path == "/" {
        path = "/index.html".to_string();
    }
    let mut lookup = path.clone();
    let mut bytes = (st.asset_get.0)(&lookup);
    if bytes.is_none() && lookup != "/index.html" {
        lookup = "/index.html".to_string();
        bytes = (st.asset_get.0)(&lookup);
    }
    match bytes {
        Some(mut b) => {
            if lookup == "/index.html" {
                let marker = "<script>window.__PSCAFE_LAN__=1;</script>";
                if let Ok(html) = String::from_utf8(b.clone()) {
                    let injected = if let Some(pos) = html.find("</head>") {
                        format!("{}{marker}{}", &html[..pos], &html[pos..])
                    } else {
                        format!("{marker}{html}")
                    };
                    b = injected.into_bytes();
                }
            }
            (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, content_type(&lookup)),
                    (header::CACHE_CONTROL, "no-store"),
                ],
                b,
            )
                .into_response()
        }
        None => err(StatusCode::NOT_FOUND, "NOT_FOUND"),
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(handle_health))
        .route("/api/select", post(handle_select))
        .route("/api/execute", post(handle_execute))
        .route("/", get(handle_asset))
        .route("/{*path}", get(handle_asset))
        .layer(middleware::from_fn_with_state(state.clone(), host_guard))
        .layer(tower_http::limit::RequestBodyLimitLayer::new(
            MAX_BODY_BYTES,
        ))
        .layer(tower_http::timeout::TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(25),
        ))
        .with_state(state)
}

/// Bind all interfaces. `0.0.0.0` is required so phones can reach the
/// server; Host validation + bearer auth provide the boundary (binding
/// loopback-only would silently break the feature).
pub async fn serve(
    router: Router,
    port: u16,
    shutdown: tokio::sync::oneshot::Receiver<()>,
) -> Result<(), String> {
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("bind {addr}: {e}"))?;
    axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = shutdown.await;
        })
        .await
        .map_err(|e| format!("serve: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{to_bytes, Bytes};
    use axum::http::HeaderValue;
    use rusqlite::Connection;

    /// App state with a freshly issued valid pairing token, returned
    /// alongside so tests can exercise authenticated call paths.
    fn state_and_token(db: Option<GatewayDb>) -> (AppState, String) {
        let lan = LanState::new();
        let token = lan
            .inner
            .lock()
            .expect("lan lock")
            .tokens
            .issue("test".into())
            .token;
        // When no connection is supplied the handle must not be able to
        // resolve one either, so point it at a path that does not exist.
        let path = std::env::temp_dir().join(format!(
            "ps-cafe-server-missing-{}.db",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let st = AppState {
            lan,
            db: DbHandle::new(path, db),
            asset_get: AssetGetter(Arc::new(|path| {
                (path == "/index.html").then(|| b"<html></html>".to_vec())
            })),
            expected_host_suffix: "127.0.0.1:7741".into(),
        };
        (st, token)
    }

    fn bearer(token: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {token}")).expect("header value"),
        );
        h
    }

    async fn body_json(r: Response) -> serde_json::Value {
        let bytes = to_bytes(r.into_body(), usize::MAX).await.expect("body");
        serde_json::from_slice(&bytes).expect("json body")
    }

    #[tokio::test]
    async fn select_without_auth_is_401_json() {
        let (st, _token) = state_and_token(None);
        let resp = handle_select(
            State(st),
            HeaderMap::new(),
            Bytes::from_static(br#"{"sql":"SELECT 1"}"#),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            resp.headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok()),
            Some("application/json")
        );
        assert_eq!(
            body_json(resp).await,
            serde_json::json!({ "ok": false, "error": "UNAUTHORIZED" })
        );
    }

    #[tokio::test]
    async fn select_with_token_without_db_is_503_json() {
        let (st, token) = state_and_token(None);
        let resp = handle_select(
            State(st),
            bearer(&token),
            Bytes::from_static(br#"{"sql":"SELECT 1"}"#),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            body_json(resp).await,
            serde_json::json!({ "ok": false, "error": "DB_NOT_READY" })
        );
    }

    #[tokio::test]
    async fn select_with_token_and_db_returns_rows() {
        let path =
            std::env::temp_dir().join(format!("ps-cafe-server-test-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        // The gateway opens the database read-only, so the file (and its
        // schema) must already exist.
        {
            let seed = Connection::open(&path).expect("seed db");
            seed.execute_batch("CREATE TABLE IF NOT EXISTS t(n INTEGER);")
                .expect("schema");
        }
        let db = GatewayDb::open(&path).expect("open db");
        let (st, token) = state_and_token(Some(db));
        let resp = handle_select(
            State(st),
            bearer(&token),
            Bytes::from_static(br#"{"sql":"SELECT 1 AS n"}"#),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        let v = body_json(resp).await;
        assert_eq!(v["ok"], serde_json::json!(true));
        assert_eq!(v["rows"][0]["n"], serde_json::json!(1));
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(format!("{}-wal", path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    }

    #[tokio::test]
    async fn execute_is_always_forbidden_read_only_mode() {
        // The write endpoint is permanently closed: no token, no
        // preference, no code path can turn it on.
        let resp = handle_execute().await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            body_json(resp).await,
            serde_json::json!({ "ok": false, "error": "READ_ONLY_MODE" })
        );
    }

    #[tokio::test]
    async fn select_rejects_write_statements() {
        let path =
            std::env::temp_dir().join(format!("ps-cafe-server-ro-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        {
            let seed = Connection::open(&path).expect("seed db");
            seed.execute_batch("CREATE TABLE IF NOT EXISTS t(n INTEGER);")
                .expect("schema");
        }
        let db = GatewayDb::open(&path).expect("open db");
        let (st, token) = state_and_token(Some(db));
        for sql in [
            r#"{"sql":"INSERT INTO t(n) VALUES (1)"}"#,
            r#"{"sql":"UPDATE t SET n = 2"}"#,
            r#"{"sql":"DELETE FROM t"}"#,
            r#"{"sql":"PRAGMA journal_mode=WAL"}"#,
        ] {
            let resp = handle_select(State(st.clone()), bearer(&token), Bytes::from_static(sql.as_bytes())).await;
            assert_eq!(resp.status(), StatusCode::FORBIDDEN, "{sql}");
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn asset_getter_keeps_callback_contract() {
        let get = AssetGetter(Arc::new(|path: &str| {
            (path == "/index.html").then(|| b"<html></html>".to_vec())
        }));
        assert_eq!((get.0)("/index.html"), Some(b"<html></html>".to_vec()));
        assert_eq!((get.0)("/missing"), None);
        let cloned = get.clone();
        assert_eq!((cloned.0)("/index.html"), Some(b"<html></html>".to_vec()));
    }
}
