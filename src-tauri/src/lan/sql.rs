//! SQL allow-list guard for the LAN gateway.
//!
//! The phone runs the same TypeScript repositories as the desktop, so the
//! gateway receives parameterized SQL. To keep this from becoming an
//! arbitrary-SQL hole, every statement is validated here:
//!
//! - exactly one statement (no `;`-chaining, no stacked queries);
//! - first keyword must be SELECT (plus the WITH…SELECT read form); never
//!   INSERT / UPDATE / DELETE / PRAGMA / ATTACH / DETACH / VACUUM / ALTER /
//!   DROP / CREATE, or anything touching `sqlite_*` internals;
//! - referenced tables must be the app's own tables;
//! - no string literals in the SQL text (all values are bound params);
//! - no write-capable SQLite functions (`writefile`, `readfile`, `edit`,
//!   `fts3_tokenizer`, …) — the connection is read-only, but a function
//!   that writes to the filesystem would bypass that.
//!
//! The gateway is a read-only visitor surface: `validate` accepts reads
//! and rejects every mutation, so the "is_write" flag is gone and a
//! write statement can never reach SQLite even if the HTTP layer
//! changes.

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

/// Functions that can write to the filesystem or otherwise escape the
/// read-only connection. Never allowed in a gateway statement.
const BANNED_FUNCTIONS: &[&str] = &[
    "writefile",
    "readfile",
    "edit",
    "fts3_tokenizer",
    "fts5_tokenizer",
    "zipfile",
    "fsdir",
    "sqlite_version",
    "sqlite_source_id",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatementKind {
    Read,
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

/// Names introduced by a `WITH` clause (`WITH x AS (...)` → `x`).
///
/// A CTE alias is not a real table, so it must be allowed explicitly
/// instead of being rejected as an unknown table. Only aliases declared
/// in the statement's own `WITH` clause are returned.
fn cte_aliases(clean: &str) -> Vec<String> {
    // Tokenizer that keeps parentheses (needed to find the end of a CTE
    // body) and drops the other punctuation.
    let tokens: Vec<String> = {
        let mut out: Vec<String> = Vec::new();
        let mut cur = String::new();
        for ch in clean.chars() {
            if ch.is_alphanumeric() || ch == '_' {
                cur.push(ch);
            } else if ch == '(' || ch == ')' || ch == ',' {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
                out.push(ch.to_string());
            } else {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
        }
        if !cur.is_empty() {
            out.push(cur);
        }
        out
    };
    let is_kw = |t: &str, k: &str| t.eq_ignore_ascii_case(k);
    let mut aliases = Vec::new();
    let mut i = 0usize;
    if tokens.first().map(|t| is_kw(t, "recursive")) == Some(true) {
        i = 1;
    }
    // Skip the `WITH` keyword itself.
    if tokens.get(i).map(|t| is_kw(t, "with")) == Some(true) {
        i += 1;
    }
    while i < tokens.len() {
        let name = tokens[i].clone();
        if is_kw(&name, "select") {
            break;
        }
        // `name AS (`
        let has_as = tokens.get(i + 1).map(|t| is_kw(t, "as")) == Some(true);
        let opens = tokens.get(i + 2).map(|t| t == "(").unwrap_or(false);
        if !has_as || !opens {
            break;
        }
        aliases.push(name.to_lowercase());
        // Skip the balanced parenthesised body.
        let mut depth = 0i32;
        let mut j = i + 2;
        while j < tokens.len() {
            if tokens[j] == "(" {
                depth += 1;
            } else if tokens[j] == ")" {
                depth -= 1;
                if depth == 0 {
                    j += 1;
                    break;
                }
            }
            j += 1;
        }
        // Optional column list `(a, b)` before the next alias.
        if tokens.get(j).map(|t| t == "(").unwrap_or(false) {
            let mut depth = 0i32;
            while j < tokens.len() {
                if tokens[j] == "(" {
                    depth += 1;
                } else if tokens[j] == ")" {
                    depth -= 1;
                    if depth == 0 {
                        j += 1;
                        break;
                    }
                }
                j += 1;
            }
        }
        // Another alias follows only if a comma comes next.
        if tokens.get(j).map(|t| t == ",").unwrap_or(false) {
            i = j + 1;
            continue;
        }
        break;
    }
    aliases
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

/// Validate one read statement.
///
/// The gateway is read-only, so this function accepts reads only. A
/// mutation is rejected here — before it can reach SQLite — and the
/// HTTP layer independently answers `403 READ_ONLY_MODE` for
/// `/api/execute`. Two independent gates, same outcome.
pub fn validate(sql: &str) -> Result<Validated, String> {
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
        "with" => {
            if lower.contains("insert")
                || lower.contains("update")
                || lower.contains("delete")
                || lower.contains("returning")
            {
                return Err("only read statements are allowed".into());
            }
            StatementKind::Read
        }
        // Any mutation keyword is rejected outright: the gateway has no
        // write capability, so there is no "write mode" to opt into.
        "insert" | "update" | "delete" | "replace" => {
            return Err("only read statements are allowed".into())
        }
        _ => return Err(format!("statement type not allowed: {first}")),
    };

    // Write-capable SQLite functions would escape the read-only
    // connection (they touch the filesystem directly).
    for banned in BANNED_FUNCTIONS {
        if contains_word(&lower, banned) {
            return Err(format!("forbidden function: {banned}"));
        }
    }

    let allowed: HashSet<&str> = ALLOWED_TABLES.iter().copied().collect();
    // A CTE alias is not a real table: allow the statement's own aliases.
    let cte = cte_aliases(&clean);
    for t in referenced_tables(&clean) {
        if !allowed.contains(t.as_str()) && !cte.contains(&t) {
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
            validate(q).unwrap_or_else(|e| panic!("{q}: {e}"));
        }
    }

    #[test]
    fn repo_writes_rejected() {
        // The gateway is read-only: no mutation may pass validation,
        // regardless of which route or flag is used.
        let writes = [
            "INSERT INTO business_days(started_at_utc, created_at_utc) VALUES (?, ?)",
            "UPDATE business_days SET ended_at_utc = ? WHERE id = ? AND ended_at_utc IS NULL",
            "INSERT INTO rental_sessions(station_id, business_day_id, started_at_utc, ended_at_utc, duration_ms, rate_minor_at_start) VALUES (?, ?, ?, NULL, NULL, ?)",
            "INSERT INTO stations(name, color_hex, sort_order, is_visible, is_active, hourly_rate_minor, created_at_utc, updated_at_utc) VALUES (?, ?, ?, 1, 1, ?, ?, ?)",
            "UPDATE stations SET name = ?, color_hex = ?, is_visible = ? WHERE id = ?",
            "DELETE FROM rental_sessions WHERE id = ?",
            "REPLACE INTO app_settings(key, value) VALUES (?, ?)",
        ];
        for q in writes {
            assert!(validate(q).is_err(), "write statement was accepted: {q}");
        }
    }

    #[test]
    fn cte_writes_rejected() {
        assert!(validate("WITH x AS (SELECT 1) INSERT INTO stations(name) VALUES (?)").is_err());
        assert!(validate("WITH x AS (SELECT 1) DELETE FROM stations").is_err());
        assert!(validate("WITH x AS (SELECT 1) UPDATE stations SET name = ?").is_err());
        assert!(validate("WITH x AS (SELECT 1) SELECT * FROM x").is_ok());
    }

    #[test]
    fn write_functions_rejected() {
        assert!(validate("SELECT writefile(?, ?)").is_err());
        assert!(validate("SELECT readfile(?)").is_err());
        assert!(validate("SELECT fts5_tokenizer(?)").is_err());
    }
}

#[cfg(test)]
mod attack_tests {
    use super::validate;

    #[test]
    fn attacks_rejected() {
        let bad = [
            "SELECT * FROM sqlite_master",
            "PRAGMA journal_mode=WAL",
            "ATTACH DATABASE ? AS x",
            "SELECT 1; DROP TABLE stations",
            "DELETE FROM stations",
            // Tautologies add nothing on the read endpoint (every SELECT on
            // allowed tables is already permitted), so they are accepted.
            "UPDATE stations SET name = ? WHERE id = 1",
            "VACUUM",
            "SELECT load_extension(?)",
            "INSERT INTO business_days SELECT * FROM sqlite_master",
            "DELETE FROM stations WHERE id = ?",
            "INSERT INTO evil(x) VALUES (?)",
        ];
        for q in bad {
            assert!(validate(q).is_err(), "{q}");
        }
    }

    #[test]
    fn literals_and_stacking_rejected() {
        assert!(validate("SELECT * FROM stations WHERE name = ?").is_ok());
        assert!(validate("SELECT * FROM stations WHERE name = 'x'").is_err());
        assert!(validate("SELECT * FROM stations; SELECT 1").is_err());
        assert!(validate("SeLeCt * FrOm stations").is_ok());
        assert!(validate("SELECT * FROM stations -- sneak").is_ok());
        assert!(validate("").is_err());
    }
}

