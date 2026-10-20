//! Private-IPv4 discovery for the LAN gateway.
//!
//! Only active, non-loopback, RFC1918 private IPv4 addresses are advertised:
//! `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`. Link-local
//! (`169.254.0.0/16`), loopback, IPv6, and virtual-provider addresses are
//! never advertised. `localhost`, hardcoded IPs, and the Vite dev server
//! are never used.

use std::net::{IpAddr, Ipv4Addr};

/// A LAN-candidate address with the interface it was seen on.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct LanInterface {
    /// Interface name as reported by the OS (e.g. `en0`, `wlan0`).
    pub name: String,
    /// Dotted private IPv4 address.
    pub address: String,
}

/// True for RFC1918 private unicast IPv4 (excludes loopback/link-local).
pub fn is_private_ipv4(ip: &Ipv4Addr) -> bool {
    // `Ipv4Addr::is_private` covers 10/8, 172.16/12, 192.168/16 on recent
    // toolchains; spell the ranges out explicitly so behavior never shifts
    // under us and loopback/link-local are unambiguous exclusions.
    let o = ip.octets();
    o[0] == 10
        || (o[0] == 172 && (16..=31).contains(&o[1]))
        || (o[0] == 192 && o[1] == 168)
}

/// Interface names that are almost always virtual/tunnel/bridge adapters.
/// A physical adapter is preferred when both exist; these are still listed
/// as selectable candidates rather than hidden.
fn looks_virtual(name: &str) -> bool {
    let n = name.to_lowercase();
    [
        "docker", "br-", "veth", "virbr", "vmnet", "vbox", "virtualbox", "vpn",
        "tun", "tap", "wg", "tailscale", "hamachi", "zerotier", "bridge",
        "awdl", "llw", "utun", "gif", "stf", "xhc",
    ]
    .iter()
    .any(|p| n.starts_with(p) || n.contains(p))
}

/// Enumerate selectable LAN interfaces from the OS interface list.
pub fn list_candidates() -> Vec<LanInterface> {
    let mut out: Vec<LanInterface> = local_ip_address::list_afinet_netifas()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(name, ip)| match ip {
            IpAddr::V4(v4) if is_private_ipv4(&v4) => Some(LanInterface {
                name,
                address: v4.to_string(),
            }),
            _ => None,
        })
        .collect();

    // Deterministic order: physical-looking adapters first, then by name.
    out.sort_by(|a, b| {
        looks_virtual(&a.name)
            .cmp(&looks_virtual(&b.name))
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| a.address.cmp(&b.address))
    });
    out.dedup();
    out
}

/// Best single address to advertise: first physical candidate, falling back
/// to the first candidate. `None` when no private IPv4 exists.
pub fn preferred(candidates: &[LanInterface]) -> Option<LanInterface> {
    candidates
        .iter()
        .find(|c| !looks_virtual(&c.name))
        .or_else(|| candidates.first())
        .cloned()
}

/// Build the phone-facing base URL. Port defaults to [`crate::lan::server::DEFAULT_PORT`].
pub fn base_url(address: &str, port: u16) -> String {
    format!("http://{address}:{port}/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_ranges_accepted() {
        for ip in ["10.0.0.5", "172.16.0.1", "172.31.255.254", "192.168.1.20"] {
            assert!(is_private_ipv4(&ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn non_private_rejected() {
        for ip in [
            "127.0.0.1",
            "169.254.10.20",
            "8.8.8.8",
            "1.1.1.1",
            "172.15.0.1",
            "172.32.0.1",
            "11.0.0.1",
            "0.0.0.0",
        ] {
            assert!(!is_private_ipv4(&ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn base_url_shape() {
        assert_eq!(base_url("192.168.1.10", 7741), "http://192.168.1.10:7741/");
    }

    #[test]
    fn preferred_skips_virtual() {
        let cands = vec![
            LanInterface {
                name: "docker0".into(),
                address: "172.17.0.1".into(),
            },
            LanInterface {
                name: "en0".into(),
                address: "192.168.1.10".into(),
            },
        ];
        assert_eq!(preferred(&cands).unwrap().name, "en0");
    }

    #[test]
    fn preferred_empty_is_none() {
        assert!(preferred(&[]).is_none());
    }
}
