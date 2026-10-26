mod lan;

use lan::address::{base_url, list_candidates, preferred};
use lan::api::{DbHandle, GatewayDb};
use lan::server::{AppState, AssetGetter, DEFAULT_PORT};
use lan::state::{LanPrefs, LanState, LanStatus};
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};

/// Preferences file next to the database (app config dir).
const PREFS_FILE: &str = "ps-cafe-lan.json";

fn prefs_path<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join(PREFS_FILE))
}

fn load_prefs<R: Runtime>(app: &AppHandle<R>) -> LanPrefs {
    let path = match prefs_path(app) {
        Some(p) => p,
        None => return LanPrefs::default(),
    };
    let data = std::fs::read(&path).unwrap_or_default();
    let mut prefs: LanPrefs = serde_json::from_slice(&data).unwrap_or_default();
    if prefs.port == 0 {
        prefs.port = DEFAULT_PORT;
    }
    prefs
}

fn save_prefs<R: Runtime>(app: &AppHandle<R>, prefs: &LanPrefs) {
    if let Some(path) = prefs_path(app) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(data) = serde_json::to_string_pretty(prefs) {
            let _ = std::fs::write(path, data);
        }
    }
}

/// Holds the running server's shutdown handle.
struct LanRuntime {
    shutdown: std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

/// Stop the HTTP gateway if running. Tokens are revoked on stop so a
/// stale QR can never reconnect silently.
fn stop_gateway<R: Runtime>(app: &AppHandle<R>, state: &LanState) {
    if let Some(rt) = app.try_state::<LanRuntime>() {
        if let Ok(mut slot) = rt.shutdown.lock() {
            if let Some(tx) = slot.take() {
                let _ = tx.send(());
            }
        }
    }
    if let Ok(mut g) = state.inner.lock() {
        g.running = false;
        g.tokens.revoke_all();
    }
}
/// Read an embedded frontend asset by URL path (`/index.html`, …).
/// In dev mode this falls back to reading `frontendDist` from disk (the
/// frontend must be built once); in production it reads the embedded
/// assets inside the app binary.
fn embedded_asset<R: Runtime>(app: &AppHandle<R>, path: &str) -> Option<Vec<u8>> {
    let resolver = app.asset_resolver();
    resolver.get(path.to_string()).map(|asset| asset.bytes)
}

/// (Re)build the advertised address: pinned interface if it still exists,
/// otherwise the preferred private-IPv4 candidate.
fn refresh_address(state: &LanState) {
    let candidates = list_candidates();
    let pinned = state
        .inner
        .lock()
        .map(|g| g.prefs.pinned_address.clone())
        .unwrap_or_default();
    let addr = if !pinned.is_empty() {
        candidates
            .iter()
            .find(|c| c.address == pinned)
            .cloned()
            .or_else(|| preferred(&candidates))
    } else {
        preferred(&candidates)
    };
    if let Ok(mut g) = state.inner.lock() {
        g.candidates = candidates;
        g.address = addr;
    }
}

/// Start (or restart) the HTTP gateway on the current prefs.
async fn start_gateway<R: Runtime>(app: &AppHandle<R>, state: &LanState) -> Result<String, String> {
    stop_gateway(app, state);
    refresh_address(state);

    let (prefs, addr) = state
        .inner
        .lock()
        .map(|g| (g.prefs.clone(), g.address.clone()))
        .map_err(|_| "lan state lock".to_string())?;
    let addr = addr.ok_or_else(|| "no private LAN address found".to_string())?;
    let url = base_url(&addr.address, prefs.port);

    let db_path = app
        .path()
        .app_config_dir()
        .map(|d| lan::api::db_path(&d))
        .map_err(|_| "no app config dir".to_string())?;
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir db dir: {e}"))?;
    }
    // The gateway opens the database read-only, so the file must already
    // exist. On a fresh install the desktop may not have created it yet;
    // start without a database rather than refusing to serve. The handle
    // is lazy: it re-resolves on every request while the file is missing,
    // so the gateway starts serving data as soon as the desktop creates it.
    let db = match GatewayDb::open(&db_path) {
        Ok(db) => Some(db),
        Err(e) => {
            eprintln!("lan gateway: database not readable yet ({e}); serving without data");
            None
        }
    };

    let app_clone = app.clone();
    let asset_get = AssetGetter(Arc::new(move |path| embedded_asset(&app_clone, path)));
    let app_state = AppState {
        lan: state.clone(),
        db: DbHandle::new(db_path, db),
        asset_get,
        expected_host_suffix: format!("{}:{}", addr.address, prefs.port),
    };
    let router = lan::server::router(app_state);
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let port = prefs.port;
    tauri::async_runtime::spawn(async move {
        if let Err(e) = lan::server::serve(router, port, rx).await {
            eprintln!("lan gateway error: {e}");
        }
    });
    if let Some(rt) = app.try_state::<LanRuntime>() {
        if let Ok(mut slot) = rt.shutdown.lock() {
            *slot = Some(tx);
        }
    }

    if let Ok(mut g) = state.inner.lock() {
        g.running = true;
        g.error = None;
    }
    Ok(url)
}


/// Read-only snapshot for the Settings panel.
#[tauri::command]
fn lan_status(state: tauri::State<LanState>) -> LanStatus {
    state.status()
}

/// QR payload for the Settings panel: issues a fresh pairing token,
/// renders the QR SVG locally, and returns `{ url, qr_svg, token }`.
/// The token is embedded in the URL fragment only.
#[tauri::command]
fn lan_pair(state: tauri::State<LanState>, label: Option<String>) -> Result<serde_json::Value, String> {
    let status = state.status();
    let url = status.url.ok_or_else(|| "gateway is not running".to_string())?;
    let label = label.unwrap_or_else(|| format!("device {}", status.paired_devices + 1));
    let token = state
        .inner
        .lock()
        .map(|mut g| g.tokens.issue(label))
        .map_err(|_| "lan state lock".to_string())?;
    let payload = lan::qr::pairing_payload(&url, &token.token);
    let qr_svg = lan::qr::qr_svg(&payload, 256)?;
    Ok(serde_json::json!({
        "url": url,
        "payload": payload,
        "qrSvg": qr_svg,
        "pairedDevices": state.status().paired_devices,
    }))
}

#[tauri::command]
async fn lan_set_enabled(
    app: AppHandle<tauri::Wry>,
    state: tauri::State<'_, LanState>,
    enabled: bool,
) -> Result<LanStatus, String> {
    {
        let mut g = state.inner.lock().map_err(|_| "lan state lock".to_string())?;
        g.prefs.enabled = enabled;
        let prefs = g.prefs.clone();
        drop(g);
        save_prefs(&app, &prefs);
    }
    if enabled {
        if let Err(e) = start_gateway(&app, &state).await {
            let mut g = state.inner.lock().map_err(|_| "lan state lock".to_string())?;
            g.running = false;
            g.error = Some(e);
        }
    } else {
        stop_gateway(&app, &state);
    }
    Ok(state.status())
}

#[tauri::command]
async fn lan_refresh(
    app: AppHandle<tauri::Wry>,
    state: tauri::State<'_, LanState>,
) -> Result<LanStatus, String> {
    refresh_address(&state);
    let enabled = state
        .inner
        .lock()
        .map(|g| g.prefs.enabled)
        .unwrap_or(false);
    if enabled {
        if let Err(e) = start_gateway(&app, &state).await {
            if let Ok(mut g) = state.inner.lock() {
                g.running = false;
                g.error = Some(e);
            }
        }
    }
    Ok(state.status())
}

#[tauri::command]
async fn lan_select_interface(
    app: AppHandle<tauri::Wry>,
    state: tauri::State<'_, LanState>,
    address: String,
) -> Result<LanStatus, String> {
    {
        let ok = state
            .inner
            .lock()
            .map(|g| g.candidates.iter().any(|c| c.address == address))
            .unwrap_or(false);
        if !ok {
            return Err("unknown interface address".into());
        }
        let mut g = state.inner.lock().map_err(|_| "lan state lock".to_string())?;
        g.prefs.pinned_address = address;
        let prefs = g.prefs.clone();
        drop(g);
        save_prefs(&app, &prefs);
    }
    lan_refresh(app, state).await
}

#[tauri::command]
fn lan_revoke_all(state: tauri::State<LanState>) -> LanStatus {
    if let Ok(mut g) = state.inner.lock() {
        g.tokens.revoke_all();
    }
    state.status()
}

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let lan_state = LanState::new();
    tauri::Builder::default()
        .manage(lan_state.clone())
        .manage(LanRuntime {
            shutdown: std::sync::Mutex::new(None),
        })
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            lan_status,
            lan_pair,
            lan_set_enabled,
            lan_refresh,
            lan_select_interface,
            lan_revoke_all,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            // Load prefs; refresh candidates so the panel shows networks
            // even before the gateway is started. Autostart only when the
            // owner previously enabled it (default off: no silent listener).
            let prefs = load_prefs(&handle);
            let enabled = prefs.enabled;
            if let Ok(mut g) = lan_state.inner.lock() {
                g.prefs = prefs;
            }
            refresh_address(&lan_state);
            if enabled {
                let st = lan_state.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = start_gateway(&handle, &st).await {
                        if let Ok(mut g) = st.inner.lock() {
                            g.running = false;
                            g.error = Some(e);
                        }
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app = window.app_handle().clone();
                if let Some(state) = app.try_state::<LanState>() {
                    stop_gateway(&app, &state);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running PS Cafe");
}


