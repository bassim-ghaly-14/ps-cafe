# Project Overview — PS Café (Offline PlayStation Cyber Café Management)

## 1. Product purpose
Windows 10 offline desktop app (Tauri 2 + React + SQLite) for a PlayStation rental café.
Operator starts/closes a **business day** (an explicit operating session, not a calendar day),
starts/stops **station rental sessions**, sees live elapsed timers, keeps durable history,
views operational statistics, and configures station cards — all without internet.

## 2. Scope — confirmed requirements
- Business-day lifecycle: open one at a time, explicit start/end timestamps, live elapsed
  clock, closed-day history, no auto-close at midnight.
- Station sessions: configurable station cards (name, color, visibility), start/stop,
  live elapsed counter derived from `start_timestamp` (never tick-accumulation),
  per-day usage aggregates, durable history across restarts.
- Statistics: ~4 meaningful summary cards; strict separation of all-time vs current-day metrics.
- Bottom navigation with exactly 3 destinations (Business Day / Stations / Settings),
  Lucide icons, no footer anywhere.
- Branding splash: ~3 s on every full React launch/reload, then restore previous tab
  (localStorage UI preference, validated, never overrides SQLite operational state).
- Offline-first: SQLite is source of truth in Tauri app-data dir; no cloud/auth/network.
- Target artifact: Windows 10 `.exe` installer (NSIS) / portable exe via Tauri bundler.

## 3. Non-goals for initial release
No pricing/billing/revenue, no per-second cost ticker, no customer management, no payments,
no inventory, no charts library, no cloud sync, no accounts, no global state framework, no ORM.
Arabic-first RTL i18n IS in v1 (ADR-011): `ar` is the default and only shipped locale;
a second language can be added later as a JSON resource without restructuring.

## 4. Major technical decisions (summary; see DECISIONS.md)
- Tauri 2 + React 19 + TypeScript strict + Vite 7 + Rust 2021 edition.
- SQLite via **tauri-plugin-sql 2.x** in production; localStorage-backed memory
  interpreter of the same SQL subset for browser dev/tests behind one DbPort (ADR-012).
  Minimal `sql:allow-*` permissions.
- Developer Mode uses an **ephemeral isolated demo DB** installed via
  `setDbOverride()`; all repositories resolve through `getActiveDb()` so demo
  traffic never touches production. Compile-time `VITE_ENABLE_DEVTOOLS` flag
  keeps the toggle out of production builds.
- i18next for Arabic-first i18n; all user-facing strings in
  `src/i18n/locales/ar/translation.json`; doc `lang=ar dir=rtl` before first paint.
- UTC millis (`INTEGER`) for all persisted instants; local formatting at display layer.
- Layered frontend: presentation / application hooks / domain rules / infrastructure
  repositories / shared utils. No SQL in components.
- Partial unique indexes enforce one open business day + one active session per station.
- Conservative seed policy: block station start when day closed; block day close while
  sessions active (with Arabic message naming the stations); block double-start;
  recover active sessions on restart from DB.

## 5. Core user workflows
1. Open app → 3 s splash → last tab restored → pill shows day OPEN/CLOSED.
2. Business Day tab → Start day → clock runs → close only when all stations idle.
3. Stations tab → Start on idle card → live HH:MM:SS → Stop → duration persisted.
4. Settings → rename/recolor/add/hide stations (never deletes history).
5. Restart/crash mid-day → active day + active sessions restored from SQLite.

## 6. HTML reference summary (`ps-cafe-mockup.html`, Arabic RTL, dark theme)
- Layout: header (brand + open/closed pill), top tab bar, day-control box with big
  mono clock, 4 stat cards, history table, station cards (colored top border, status tag,
  big timer, cost line, full-width start/stop, per-day footer), settings rows.
- Visual identity to preserve: `--bg #070b14, --panel #0d1424, --line #1e2c4a,
  --accent #2ee6ff, --ok #19e3a1, --bad #ff4d6d`, mono timers, card glow when running.
- Conflicts resolved per spec: mockup's **top tabs → bottom nav**; **footer note → deleted**;
  **revenue/cost/rate columns → removed** (no billing in v1); mockup's "close day force-stops
  devices with confirm()" → **blocked** (must stop stations first); mockup's in-memory
  `st` object → **SQLite**; mockup's tick-derived aggregates → **DB-computed durations**.

## 7. Assumptions & unresolved questions
- A1: Single operator, single window — no concurrency beyond double-click guard.
- A2: System clock trusted; monotonic guard only warns on backward jumps (see DATA_MODEL).
- A3: Station `sort_order` + `is_visible` suffice for v1 ordering/hiding.
- Q1 (needs approval): block day-close with active sessions (recommended) vs allow with
  auto-stop? Default = block.
- Q2: Rename station — retroactive display or snapshot name on session? Default = live name.
- Q3: Club name setting in v1 or defer? Default = defer, keep stations-only settings.
