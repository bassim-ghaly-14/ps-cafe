//! SQL allow-list guard for the LAN gateway.
//!
//! The phone runs the same TypeScript repositories as the desktop, so the
//! gateway receives parameterized SQL. To keep this from becoming an
//! arbitrary-SQL hole, every statement is validated here:
//!
//! - exactly one statement (no `;`-chaining, no stacked queries);
//! - first keyword must be SELECT / INSERT / UPDATE / DELETE (plus the
//!   WITH…SELECT read form); never PRAGMA, ATTACH, DETACH, VACUUM, ALTER,
//!   DROP, CREATE, or anything touching `sqlite_*` internals;
//! - referenced tables must be the app's own tables;
//! - no string literals in the SQL text (all values are bound params).

use std::collections::HashSet;

/// Tables owned by PS-Cafe. Anything else is rejected.
const ALLOWED_TABLES: &[&str] = &[
    "business_days",
    "stations",
    "rental_sessions",
    "schema_meta",
    "app_settings",
];

/// Keywords that are never allowed anywhere in the statement.
const BANNED_KEYWORDS: &[&str] = &[
    "pragma",
    "attach",
    "detach",
    "vacuum",
    "reindex",
    "alter",
    "drop",
    "create",
    "trigger",
    "virtual",
    "load_extension",
    "sqlite_",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatementKind {
    Read,
    Write,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Validated {
    pub kind: StatementKind,
}

/// Normalize: strip line/block comments and collapse whitespace.
fn strip_comments(sql: &str) -> String {
    let bytes = sql.as_bytes();
    let mut out = String::with_capacity(sql.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'-' && i + 1 < bytes.len() && bytes[i + 1] == b'-' {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
        } else if bytes[i] == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i += 2;
            out.push(' ');
        } else {
            out.push(bytes[i] as char);
            i += 1;
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Iterate word tokens of a comment-free statement.
fn words(s: &str) -> Vec<&str> {
    s.split(|c: char| !c.is_alphanumeric() && c != '_' && c != '?')
        .filter(|w| !w.is_empty())
        .collect()
}

/// Tables after FROM / JOIN / INTO / UPDATE / TABLE keywords, with
/// `schema.table` reduced to `table`.
fn referenced_tables(clean: &str) -> Vec<String> {
    let words = words(clean);
    let mut tables = Vec::new();
    let mut expect_table = false;
    for w in words {
        let lw = w.to_lowercase();
        if expect_table {
            expect_table = false;
            if matches!(lw.as_str(), "select" | "where" | "values" | "set") {
                continue;
            }
            let t = w
                .trim_matches(|c| c == '"' || c == '\'' || c == '`' || c == '[' || c == ']')
                .rsplit('.')
                .next()
                .unwrap_or(w)
                .to_lowercase();
            if !t.is_empty() && t != "?" {
                tables.push(t);
            }
            continue;
        }
        if matches!(lw.as_str(), "from" | "join" | "into" | "update" | "table") {
            expect_table = true;
        }
    }
    tables
}

/// True when `needle` occurs as a standalone word in `hay` (case-folded).
fn contains_word(hay: &str, needle: &str) -> bool {
    let mut rest = hay;
    while let Some(pos) = rest.find(needle) {
        let before = rest[..pos].chars().last();
        let after = rest[pos + needle.len()..].chars().next();
        let boundary = |c: Option<char>| {
            c.map(|c| !c.is_alphanumeric() && c != '_').unwrap_or(true)
        };
        if boundary(before) && boundary(after) {
            return true;
        }
        rest = &rest[pos + needle.len()..];
    }
    false
}

/// Validate one statement. `is_write` mirrors the endpoint used
/// (`select` = read path, `execute` = write path): the kind inferred from
/// the SQL must match the endpoint, so a write can never ride the
/// read-only route and vice versa.
pub fn validate(sql: &str, is_write: bool) -> Result<Validated, String> {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return Err("empty statement".into());
    }
    if trimmed.len() > 16_384 {
        return Err("statement too long".into());
    }
    // No string literals: every value must be a bound parameter.
    if trimmed.contains('\'') || trimmed.contains('"') || trimmed.contains('`') {
        return Err("literals are not allowed; use parameters".into());
    }
    // Exactly one statement (trailing `;` allowed).
    let mut semis = 0;
    for (idx, ch) in trimmed.char_indices() {
        if ch == ';' {
            semis += 1;
            if trimmed[idx + 1..].trim().is_empty() {
                break;
            }
            return Err("only a single statement is allowed".into());
        }
    }
    if semis > 1 {
        return Err("only a single statement is allowed".into());
    }

    let clean = strip_comments(trimmed);
    let lower = clean.to_lowercase();
    for banned in BANNED_KEYWORDS {
        if contains_word(&lower, banned) {
            return Err(format!("forbidden keyword: {banned}"));
        }
    }

    let first = lower
        .split_whitespace()
        .next()
        .ok_or_else(|| "empty statement".to_string())?;
    let kind = match first {
        "select" => StatementKind::Read,
        "insert" | "update" | "delete" => StatementKind::Write,
        "with" => {
            if lower.contains("insert") || lower.contains("update") || lower.contains("delete") {
                StatementKind::Write
            } else {
                StatementKind::Read
            }
        }
        _ => return Err(format!("statement type not allowed: {first}")),
    };

    if is_write != (kind == StatementKind::Write) {
        return Err("statement kind does not match endpoint".into());
    }

    let allowed: HashSet<&str> = ALLOWED_TABLES.iter().copied().collect();
    for t in referenced_tables(&clean) {
        if !allowed.contains(t.as_str()) {
            return Err(format!("table not allowed: {t}"));
        }
    }

    Ok(Validated { kind })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_reads_pass() {
        let reads = [
            "SELECT * FROM business_days WHERE ended_at_utc IS NULL LIMIT 1",
            "SELECT * FROM business_days ORDER BY id DESC LIMIT (?)",
            "SELECT * FROM business_days ORDER BY started_at_utc DESC, id DESC LIMIT (?)",
            "SELECT COUNT(*) AS count FROM business_days WHERE ended_at_utc IS NOT NULL",
            "SELECT * FROM rental_sessions WHERE station_id = ? AND ended_at_utc IS NULL LIMIT 1",
            "SELECT * FROM rental_sessions WHERE ended_at_utc IS NULL ORDER BY id ASC",
            "SELECT hourly_rate_minor FROM stations WHERE id = ? LIMIT 1",
            "SELECT * FROM stations ORDER BY sort_order ASC, id ASC",
            "SELECT MAX(sort_order) AS maxOrder FROM stations",
            "SELECT version FROM schema_meta",
            "SELECT station_id AS stationId, COUNT(*) AS count FROM rental_sessions WHERE business_day_id = ? GROUP BY station_id",
            "SELECT COUNT(*) AS count FROM rental_sessions WHERE station_id = ?",
            "SELECT id, duration_ms, rate_minor_at_start FROM rental_sessions WHERE station_id = ? AND ended_at_utc IS NOT NULL ORDER BY id ASC",
            // Dynamic station-history sorts: one variant per column/direction.
            "SELECT * FROM rental_sessions WHERE station_id = ? ORDER BY started_at_utc IS NULL, started_at_utc ASC, id DESC LIMIT ? OFFSET ?",
            "SELECT * FROM rental_sessions WHERE station_id = ? ORDER BY started_at_utc IS NULL, started_at_utc DESC, id DESC LIMIT ? OFFSET ?",
            "SELECT * FROM rental_sessions WHERE station_id = ? ORDER BY ended_at_utc IS NULL, ended_at_utc ASC, id DESC LIMIT ? OFFSET ?",
            "SELECT * FROM rental_sessions WHERE station_id = ? ORDER BY ended_at_utc IS NULL, ended_at_utc DESC, id DESC LIMIT ? OFFSET ?",
            "SELECT * FROM rental_sessions WHERE station_id = ? ORDER BY duration_ms IS NULL, duration_ms ASC, id DESC LIMIT ? OFFSET ?",
            "SELECT * FROM rental_sessions WHERE station_id = ? ORDER BY duration_ms IS NULL, duration_ms DESC, id DESC LIMIT ? OFFSET ?",
            "SELECT * FROM rental_sessions WHERE station_id = ? ORDER BY rate_minor_at_start IS NULL, rate_minor_at_start ASC, id DESC LIMIT ? OFFSET ?",
            "SELECT * FROM rental_sessions WHERE station_id = ? ORDER BY rate_minor_at_start IS NULL, rate_minor_at_start DESC, id DESC LIMIT ? OFFSET ?",
        ];
        for q in reads {
            validate(q, false).unwrap_or_else(|e| panic!("{q}: {e}"));
        }
    }

    #[test]
    fn repo_writes_pass() {
        let writes = [
            "INSERT INTO business_days(started_at_utc, created_at_utc) VALUES (?, ?)",
            "UPDATE business_days SET ended_at_utc = ? WHERE id = ? AND ended_at_utc IS NULL",
            "INSERT INTO rental_sessions(station_id, business_day_id, started_at_utc, ended_at_utc, duration_ms, rate_minor_at_start) VALUES (?, ?, ?, NULL, NULL, ?)",
            "INSERT INTO stations(name, color_hex, sort_order, is_visible, is_active, hourly_rate_minor, created_at_utc, updated_at_utc) VALUES (?, ?, ?, 1, 1, ?, ?, ?)",
            "UPDATE stations SET name = ?, color_hex = ?, is_visible = ? WHERE id = ?",
        ];
        for q in writes {
            validate(q, true).unwrap_or_else(|e| panic!("{q}: {e}"));
        }
    }
}

#[cfg(test)]
mod attack_tests {
    use super::validate;

    #[test]
    fn attacks_rejected() {
        let bad: &[(&str, bool)] = &[
            ("SELECT * FROM sqlite_master", false),
            ("PRAGMA journal_mode=WAL", false),
            ("ATTACH DATABASE ? AS x", false),
            ("SELECT 1; DROP TABLE stations", false),
            ("DELETE FROM stations", false),
            // Tautologies add nothing on the read endpoint (every SELECT on
            // allowed tables is already permitted), so they are accepted.
            ("UPDATE stations SET name = ? WHERE id = 1", false),
            ("VACUUM", false),
            ("SELECT load_extension(?)", false),
            ("INSERT INTO business_days SELECT * FROM sqlite_master", true),
            ("SELECT * FROM business_days WHERE id = ?", true),
            ("DELETE FROM stations WHERE id = ?", false),
            ("INSERT INTO evil(x) VALUES (?)", true),
        ];
        for (q, is_write) in bad {
            assert!(validate(q, *is_write).is_err(), "{q}");
        }
    }

    #[test]
    fn literals_and_stacking_rejected() {
        assert!(validate("SELECT * FROM stations WHERE name = ?", false).is_ok());
        assert!(validate("SELECT * FROM stations WHERE name = 'x'", false).is_err());
        assert!(validate("SELECT * FROM stations; SELECT 1", false).is_err());
        assert!(validate("SeLeCt * FrOm stations", false).is_ok());
        assert!(validate("SELECT * FROM stations -- sneak", false).is_ok());
        assert!(validate("", false).is_err());
    }
}
