# PS Cafe — offline PlayStation café manager (Tauri 2 + React + SQLite)

Arabic-first, fully offline desktop application for managing a PlayStation
rental café. Business-day lifecycle, station rental sessions with live timers,
durable history, statistics, and station configuration — no internet required.

## Features
- **يوم العمل (Business Day):** open/close with a live elapsed clock, history
  table, 4 summary stat cards computed from SQLite records. Closing is blocked
  while any station has an active session (with the station names listed).
- **الأجهزة (Stations):** station cards with colored borders, running glow,
  live HH:MM:SS timers derived from persisted timestamps, per-day usage stats.
  Start requires an open business day; stop persists the duration.
- **الإعدادات (Settings):** add, rename, recolor, show/hide, activate/deactivate
  stations. Never deletes history; cannot deactivate a running station.
- **Arabic-first RTL UI** via i18next (ar is the only shipped locale; adding a
  language = adding a JSON resource file). Document `lang=ar dir=rtl` is applied
  before first paint. All strings come from `src/i18n/locales/ar/translation.json`.
- **3-second branded splash** on every full React reload; last selected tab is
  restored (validated; falls back to يوم العمل on invalid values).
- **Recovery:** an open business day and active sessions survive restart/crash —
  timers resume from the persisted `started_at_utc`, never from memory.

## Prerequisites
- **Development:** Node 20+, npm 11+, Rust stable (1.77+), Tauri 2 system deps
  ([tauri.app prerequisites](https://tauri.app/start/prerequisites/)).
- **Windows 10 (end user):** WebView2 Runtime (bundled/installed by the NSIS
  installer on machines with Windows 10 1803+; otherwise install from Microsoft).
  No Node.js, npm, or Rust needed on the user's machine.

## Commands
| Command | Purpose |
| --- | --- |
| `npm install` | install dependencies |
| `npm run dev` | Vite dev server (port 1420) with devtools ON + localStorage-backed DB fallback |
| `npm run typecheck` | strict TypeScript check |
| `npm test` | Vitest suite (domain, db, repositories, UI — 80 tests) |
| `npm run lint` | Prettier format check |
| `npm run format` | Prettier write |
| `npm run build` | typecheck + production frontend bundle (devtools OFF) |
| `npm run build:internal` | internal testing bundle with devtools ON (never ship to the cafe) |
| `npx tauri dev` | desktop shell in dev mode (real SQLite in app-data dir) |
| `npx tauri build` | release build + platform bundles |

## Database
- **Engine:** SQLite via `tauri-plugin-sql`, file `ps-cafe.db`.
- **Location (production):** Tauri app-data directory, e.g.
  - Windows: `%APPDATA%\com.pscafe.app\ps-cafe.db`
  - macOS: `~/Library/Application Support/com.pscafe.app/ps-cafe.db`
  - Linux: `~/.local/share/com.pscafe.app/ps-cafe.db`
  Never in the installation directory or `dist/`. Updates do not overwrite it.
- **Browser/dev fallback:** when not running inside Tauri (plain `npm run dev`
  or tests), a localStorage-backed interpreter of the same SQL subset is used so
  the UI is fully exercisable without a desktop shell. Production always uses
  real SQLite (verified via `getBackend()`).
- **Migrations:** ordered, versioned (`schema_meta` table), applied at startup;
  v1 = full schema in `src/db/migrations.ts` (canonical copy in `schema.sql`).
- **Invariants:** partial unique indexes enforce one open business day and one
  active session per station at the database level; repositories re-validate in
  the same transaction path so double-clicks cannot corrupt data.
- **Backup/recovery:** copy `ps-cafe.db` (plus `-wal`/`-shm` if present) while
  the app is closed. Restore by placing the file back in the app-data dir.

## Building for Windows 10
This project was developed and verified on macOS. To produce the Windows NSIS
installer:
1. On a Windows 10+ machine install: Node 20+, Rust (msvc toolchain), WebView2
   Runtime, and the Tauri 2 prerequisites.
2. Clone the repo, run `npm install`.
3. Run `npx tauri build`.
4. The installer appears at `src-tauri/target/release/bundle/nsis/PS Cafe_0.1.0_x64-setup.exe`.

The NSIS target is already configured in `src-tauri/tauri.conf.json`
(`"targets": ["app", "dmg", "nsis"]` — each platform builds the targets it
supports). The Windows `.exe` was not built in this macOS environment; the same
`tauri build` command applies on Windows.

## Offline guarantees
- No network calls in application code. The frontend bundle contains no CDN
  references, no remote fonts, no external APIs, and no telemetry.
- All translation resources, icons (Lucide, bundled), and styles are local.
- Verified by scanning `dist/` for `https://` — only documentation URLs inside
  React/i18next error messages remain (never fetched at runtime).

## Known limitations
- Clock changes: elapsed durations derive from wall-clock UTC timestamps
  (`Date.now()`). A backwards system-clock adjustment clamps displayed timers to
  `00:00:00` and can under-measure; ordinary NTP corrections are fine, but these
  are not monotonic-clock guarantees.
- Single-operator app: concurrency guards exist (DB constraints), but the UI
  assumes one window.
- v1 scope deliberately excludes billing/pricing, customer management, club-name
  settings, charts, and sync (see `docs/DECISIONS.md`).

## Developer Mode (dev builds only)
- `npm run dev` enables the developer section in Settings (PIN 2214, required
  on every activation). It installs an ephemeral in-memory demo database —
  demo edits never touch the real `ps-cafe.db`; exiting discards demo data
  and reloads production state. Reloads always default back to normal mode.
- `npm run build` (production release) compiles the toggle out; use
  `npm run build:internal` only for an explicit internal testing bundle.
- The fixed PIN is an accidental-access barrier for a local tool, not strong
  authentication. Full policy, scenarios, and isolation guarantees are in
  `docs/POST_RELEASE_HARDENING_REPORT.md`.

