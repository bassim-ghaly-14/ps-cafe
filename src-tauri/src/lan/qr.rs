//! Local QR-code generation for the Settings LAN panel.
//!
//! Generated entirely on-device with the `qrcode` crate (SVG output) —
//! nothing is uploaded anywhere. The encoded payload is the phone-facing
//! URL with the pairing token in the fragment: the token is never a URL
//! path/query and therefore never appears in server access patterns.

use qrcode::render::svg;
use qrcode::{EcLevel, QrCode};

/// Render `payload` as an SVG document string (quiet zone included).
/// Returns an error string instead of failing — the Settings panel must
/// degrade to a copyable URL when QR encoding fails.
pub fn qr_svg(payload: &str, min_size: u32) -> Result<String, String> {
    let code =
        QrCode::with_error_correction_level(payload.as_bytes(), EcLevel::M)
            .map_err(|e| format!("QR encode failed: {e}"))?;
    Ok(code
        .render::<svg::Color>()
        .min_dimensions(min_size, min_size)
        .quiet_zone(true)
        .build())
}

/// Build the QR payload: base URL + token carried in the fragment.
pub fn pairing_payload(base_url: &str, token: &str) -> String {
    format!("{base_url}#k={token}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn svg_renders_and_parses() {
        let svg = qr_svg("http://192.168.1.10:7741/#k=pscafe_abc", 240).unwrap();
        assert!(svg.contains("<svg"));
        assert!(svg.contains("</svg>") || svg.contains("/>"));
    }

    #[test]
    fn payload_carries_token_in_fragment() {
        let p = pairing_payload("http://192.168.1.10:7741/", "pscafe_abc123");
        assert_eq!(p, "http://192.168.1.10:7741/#k=pscafe_abc123");
        assert!(!p.contains("?k="));
    }

    #[test]
    fn oversized_payload_errors_cleanly() {
        let big = "x".repeat(4000);
        assert!(qr_svg(&big, 240).is_err());
    }
}
