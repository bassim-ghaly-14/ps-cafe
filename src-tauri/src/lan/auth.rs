//! Pairing-token authentication for the LAN gateway.
//!
//! Trust model: LAN reachability is NOT authorization. Every `/api/*`
//! request must carry a bearer token issued by pairing through the
//! desktop Settings QR panel. The token is embedded in the QR behind a
//! URL fragment (`#k=...`) so it never hits server logs as a path/query
//! and is never sent in the `Host`-validated static-asset path.
//!
//! Administrative/destructive operations (`execute`) additionally require
//! writes to be enabled on the desktop (`allow_writes`); read-only
//! (`select`) callers only need a valid token.

use rand::RngCore;
use std::time::{Duration, Instant};

/// How long an idle pairing token stays valid (8h covers a full shift).
pub const TOKEN_TTL: Duration = Duration::from_secs(8 * 60 * 60);
/// Maximum simultaneously live tokens (bounds memory on the desktop).
pub const MAX_TOKENS: usize = 8;

/// A live pairing token.
#[derive(Debug, Clone)]
pub struct PairToken {
    /// Opaque bearer value (`pscafe_` + 32 hex chars).
    pub token: String,
    #[allow(dead_code)]
    pub issued_at: Instant,
    pub last_used: Instant,
    /// Human label for the Settings panel (e.g. "Phone 1").
    pub label: String,
}

impl PairToken {
    pub fn is_expired(&self, now: Instant) -> bool {
        now.duration_since(self.last_used) > TOKEN_TTL
    }
}

/// Constant-time comparison to avoid leaking token prefixes via timing.
pub fn tokens_equal(a: &str, b: &str) -> bool {
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    if ab.len() != bb.len() {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..ab.len() {
        diff |= ab[i] ^ bb[i];
    }
    diff == 0
}

/// Generate a fresh opaque bearer token.
pub fn new_token() -> String {
    let mut bytes = [0u8; 16];
    rand::rng().fill_bytes(&mut bytes);
    let mut s = String::with_capacity(7 + 32);
    s.push_str("pscafe_");
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// In-memory token store with TTL eviction and a fixed cap.
#[derive(Debug, Default)]
pub struct TokenStore {
    tokens: Vec<PairToken>,
}

impl TokenStore {
    pub fn issue(&mut self, label: String) -> PairToken {
        let now = Instant::now();
        self.evict_expired(now);
        while self.tokens.len() >= MAX_TOKENS {
            // Evict the least-recently-used token first.
            if let Some(pos) = self
                .tokens
                .iter()
                .enumerate()
                .min_by_key(|(_, t)| t.last_used)
                .map(|(i, _)| i)
            {
                self.tokens.remove(pos);
            } else {
                break;
            }
        }
        let t = PairToken {
            token: new_token(),
            issued_at: now,
            last_used: now,
            label,
        };
        self.tokens.push(t.clone());
        t
    }

    /// Validate a bearer value; refreshes `last_used` on success.
    pub fn validate(&mut self, bearer: &str) -> bool {
        let now = Instant::now();
        self.evict_expired(now);
        for t in self.tokens.iter_mut() {
            if tokens_equal(&t.token, bearer) {
                t.last_used = now;
                return true;
            }
        }
        false
    }

    pub fn revoke_all(&mut self) {
        self.tokens.clear();
    }

    pub fn count(&self) -> usize {
        self.tokens.len()
    }

    pub fn labels(&self) -> Vec<String> {
        self.tokens.iter().map(|t| t.label.clone()).collect()
    }

    fn evict_expired(&mut self, now: Instant) {
        self.tokens.retain(|t| !t.is_expired(now));
    }
}

/// Extract a bearer token from `Authorization: Bearer <token>`.
pub fn bearer_from_header(value: Option<&str>) -> Option<String> {
    let v = value?.trim();
    let token = v.strip_prefix("Bearer ").or_else(|| v.strip_prefix("bearer "))?;
    let token = token.trim();
    if token.is_empty() || token.len() > 128 {
        return None;
    }
    Some(token.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_shape() {
        let t = new_token();
        assert!(t.starts_with("pscafe_"));
        assert_eq!(t.len(), 7 + 32);
        assert!(t[7..].chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn tokens_unique() {
        assert_ne!(new_token(), new_token());
    }

    #[test]
    fn compare_is_exact() {
        assert!(tokens_equal("abc", "abc"));
        assert!(!tokens_equal("abc", "abd"));
        assert!(!tokens_equal("abc", "abcd"));
    }


    #[test]
    fn expiry_and_cap() {
        let mut s = TokenStore::default();
        for i in 0..(MAX_TOKENS + 3) {
            s.issue(format!("d{i}"));
        }
        assert!(s.count() <= MAX_TOKENS);
        for t in s.tokens.iter_mut() {
            t.last_used = Instant::now() - TOKEN_TTL - Duration::from_secs(1);
        }
        assert!(!s.validate(&s.tokens.first().cloned().unwrap().token));
        assert_eq!(s.count(), 0);
    }

    #[test]
    fn bearer_parsing() {
        assert_eq!(
            bearer_from_header(Some("Bearer pscafe_abc")),
            Some("pscafe_abc".to_string())
        );
        assert_eq!(bearer_from_header(Some("bearer pscafe_abc ")), Some("pscafe_abc".to_string()));
        assert_eq!(bearer_from_header(Some("Basic abc")), None);
        assert_eq!(bearer_from_header(Some("Bearer ")), None);
        assert_eq!(bearer_from_header(None), None);
    }
}
