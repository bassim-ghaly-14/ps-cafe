//! Shared mutable state for the LAN gateway.
//!
//! All server configuration is explicit and desktop-controlled:
//! - `enabled`: gateway on/off (Settings toggle, persisted to disk).
//! - `allow_writes`: whether paired phones may run `execute` (start/stop
//!   sessions, open/close days, station edits). Reads always work with a
//!   valid token; writes additionally require this flag.
//! - `port` / `active_address`: what is currently advertised.

use crate::lan::address::LanInterface;
use crate::lan::auth::TokenStore;
use std::sync::{Arc, Mutex};

/// Persisted gateway preferences (JSON file next to the database).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LanPrefs {
    pub enabled: bool,
    pub allow_writes: bool,
    pub port: u16,
    /// Pinned interface address, or empty for automatic selection.
    pub pinned_address: String,
}

impl Default for LanPrefs {
    fn default() -> Self {
        Self {
            enabled: false,
            allow_writes: true,
            port: crate::lan::server::DEFAULT_PORT,
            pinned_address: String::new(),
        }
    }
}

/// Runtime snapshot exposed to the Settings panel.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanStatus {
    pub running: bool,
    pub enabled: bool,
    pub allow_writes: bool,
    pub address: Option<String>,
    pub port: u16,
    pub url: Option<String>,
    pub candidates: Vec<LanInterface>,
    pub paired_devices: usize,
    pub paired_labels: Vec<String>,
    pub error: Option<String>,
}

/// The gateway's shared state (cheap to clone, lock briefly).
#[derive(Debug, Clone)]
pub struct LanState {
    pub inner: Arc<Mutex<LanInner>>,
}

#[derive(Debug, Default)]
pub struct LanInner {
    pub prefs: LanPrefs,
    pub tokens: TokenStore,
    pub running: bool,
    pub address: Option<LanInterface>,
    pub candidates: Vec<LanInterface>,
    pub error: Option<String>,
}

impl LanState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(LanInner::default())),
        }
    }

    pub fn status(&self) -> LanStatus {
        let g = self.inner.lock().expect("lan state lock");
        let url = g
            .address
            .as_ref()
            .map(|a| crate::lan::address::base_url(&a.address, g.prefs.port));
        LanStatus {
            running: g.running,
            enabled: g.prefs.enabled,
            allow_writes: g.prefs.allow_writes,
            address: g.address.as_ref().map(|a| a.address.clone()),
            port: g.prefs.port,
            url,
            candidates: g.candidates.clone(),
            paired_devices: g.tokens.count(),
            paired_labels: g.tokens.labels(),
            error: g.error.clone(),
        }
    }
}

impl Default for LanState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lan_inner_default_preserves_field_values() {
        let d = LanInner::default();
        // prefs keep the manual LanPrefs defaults (derive calls them too).
        assert!(!d.prefs.enabled);
        assert!(d.prefs.allow_writes);
        assert_eq!(d.prefs.port, crate::lan::server::DEFAULT_PORT);
        assert_eq!(d.prefs.pinned_address, "");
        assert_eq!(d.tokens.count(), 0);
        assert!(!d.running);
        assert!(d.address.is_none());
        assert!(d.candidates.is_empty());
        assert!(d.error.is_none());
    }
}
