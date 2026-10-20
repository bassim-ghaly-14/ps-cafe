//! LAN HTTP gateway: routes, auth/host middleware, static assets.
//!
//! Same-origin by construction: the phone loads the app from this server
//! and calls `/api/*` on the same origin, so no CORS headers are ever
//! emitted. Requests whose `Host` does not match the advertised
//! address:port (or loopback for desktop self-checks) are rejected with
//! 421 — this blunts DNS-rebinding attacks.
//!
//! Public (unauthenticated): `/`, static assets, `/api/health`.
//! Authenticated (bearer token): `/api/select`, `/api/execute`.
//! `execute` additionally requires `allow_writes` on the desktop.

use crate::lan::api::{GatewayDb, Param};
use crate::lan::auth;
use crate::lan::state::LanState;
use axum::Router;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use std::sync::Arc;
use std::time::Duration;

/// Default LAN port (unprivileged, unlikely to collide on a cafe PC).
pub const DEFAULT_PORT: u16 = 7741;
/// Maximum JSON body for `/api/*` (statements + params are tiny).
pub const MAX_BODY_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone)]
pub struct AppState {
    pub lan: LanState,
    /// `None` until the database file has been located/opened.
    pub db: Option<GatewayDb>,
    pub asset_get: AssetGetter,
    pub expected_host_suffix: String,
}

/// Cloneable asset reader (avoids Debug issues with closures).
#[derive(Clone)]
pub struct AssetGetter(pub Arc<dyn Fn(&str) -> Option<Vec<u8>> + Send + Sync>);

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
fn require_auth(st: &AppState, headers: &HeaderMap) -> Result<(), Response> {
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
        Err(err(StatusCode::UNAUTHORIZED, "UNAUTHORIZED"))
    }
}

fn db_or_503(st: &AppState) -> Result<GatewayDb, Response> {
    st.db.clone().ok_or_else(|| err(StatusCode::SERVICE_UNAVAILABLE, "DB_NOT_READY"))
}

/// POST /api/select — validated read-only SQL, returns rows.
async fn handle_select(
    State(st): State<AppState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    if let Err(r) = require_auth(&st, &headers) {
        return r;
    }
    let req: SqlRequest = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(_) => return err(StatusCode::BAD_REQUEST, "BAD_JSON"),
    };
    if let Err(code) = crate::lan::sql::validate(&req.sql, false) {
        return err(StatusCode::FORBIDDEN, &format!("SQL_REJECTED:{code}"));
    }
    let db = match db_or_503(&st) {
        Ok(d) => d,
        Err(r) => return r,
    };
    match tokio::task::spawn_blocking(move || db.select(&req.sql, &req.params)).await {
        Ok(Ok(rows)) => json_ok(serde_json::json!({ "rows": rows })),
        Ok(Err(e)) => err(StatusCode::UNPROCESSABLE_ENTITY, &e),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "DB_TASK_FAILED"),
    }
}

/// POST /api/execute — validated writes; requires `allow_writes`.
async fn handle_execute(
    State(st): State<AppState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    if let Err(r) = require_auth(&st, &headers) {
        return r;
    }
    let allowed = st.lan.inner.lock().map(|g| g.prefs.allow_writes).unwrap_or(false);
    if !allowed {
        return err(StatusCode::FORBIDDEN, "WRITES_DISABLED");
    }
    let req: SqlRequest = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(_) => return err(StatusCode::BAD_REQUEST, "BAD_JSON"),
    };
    if let Err(code) = crate::lan::sql::validate(&req.sql, true) {
        return err(StatusCode::FORBIDDEN, &format!("SQL_REJECTED:{code}"));
    }
    let db = match db_or_503(&st) {
        Ok(d) => d,
        Err(r) => return r,
    };
    match tokio::task::spawn_blocking(move || db.execute(&req.sql, &req.params)).await {
        Ok(Ok(affected)) => json_ok(serde_json::json!({ "affected": affected })),
        Ok(Err(e)) => err(StatusCode::UNPROCESSABLE_ENTITY, &e),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "DB_TASK_FAILED"),
    }
}

fn json_ok(v: serde_json::Value) -> Response {
    let mut obj = serde_json::Map::new();
    obj.insert("ok".into(), serde_json::Value::Bool(true));
    if let serde_json::Value::Object(m) = v {
        for (k, val) in m {
            obj.insert(k, val);
        }
    }
    (StatusCode::OK, [(header::CONTENT_TYPE, "application/json")], serde_json::Value::Object(obj).to_string())
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
        .layer(tower_http::limit::RequestBodyLimitLayer::new(MAX_BODY_BYTES))
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
