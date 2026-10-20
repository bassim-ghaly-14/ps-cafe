//! LAN gateway module: serve the PS-Cafe frontend to phones on the local
//! network (via QR code) and proxy parameterized SQL to the desktop's
//! SQLite database.
//!
//! Architecture summary (see docs/lan-mobile.md for the full contract):
//! - Business logic stays in TypeScript. The HTTP [`DbPort`]-equivalent on
//!   the phone forwards the exact same SQL the repositories issue.
//! - This module is transport-only: auth, host validation, static assets,
//!   QR generation, and SQL execution against the same `ps-cafe.db` file
//!   that `tauri-plugin-sql` uses (app_config_dir/ps-cafe.db).
//! - The database `DbPool` accessor on the plugin is private, so this
//!   gateway opens its own connection to the same file with
//!   WAL + busy_timeout + foreign_keys for safe concurrent access.

pub mod address;
pub mod api;
pub mod auth;
pub mod qr;
pub mod server;
pub mod sql;
pub mod state;
