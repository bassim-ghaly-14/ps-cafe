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

| Command                      | Purpose                                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install`                | install dependencies                                                                                                                                 |
| `npm run dev`                | Vite dev server (port 1420) with devtools ON + localStorage-backed DB fallback                                                                       |
| `npm run typecheck`          | strict TypeScript check                                                                                                                              |
| `npm test`                   | Vitest suite (domain, db, repositories, UI — 80 tests)                                                                                               |
| `npm run lint`               | Prettier format check                                                                                                                                |
| `npm run format`             | Prettier write                                                                                                                                       |
| `npm run build`              | typecheck + production frontend bundle (devtools OFF)                                                                                                |
| `npm run build:prod`         | canonical production frontend bundle (devtools OFF) + safe cleanup of stale production installers first                                              |
| `npm run clean:prod-bundles` | remove only stale production installers (`PS Cafe_*.exe`, `PS-Cafe-Setup-*.exe`, `PS Cafe_*.dmg`); preserves caches, databases, sources, Git history |
| `npm run build:prod:tauri`   | canonical local production desktop build (production Tauri config only; never builds internal)                                                       |
| `npm run build:internal`     | internal testing bundle with devtools ON (never ship to the cafe)                                                                                    |
| `npx tauri dev`              | desktop shell in dev mode (real SQLite in app-data dir)                                                                                              |
| `npm run tauri:internal`     | internal desktop build with devtools ON (never ship to the cafe)                                                                                     |

Canonical local production build:

```bash
npm run build:prod:tauri
```

This builds ONLY the production app (`PS Cafe`, `com.pscafe.desktop`) and never
triggers `tauri.internal.conf.json`. `npm run build:prod` runs first via
Tauri's `beforeBuildCommand` (typecheck + Vite `dist/`). `npm run
clean:prod-bundles` runs first via the `prebuild:prod` hook so a stale
installer never sits next to the fresh one. Rust incremental caches are
preserved; no database, user config, source, or Git data is touched.

## Database

- **Engine:** SQLite via `tauri-plugin-sql`, file `ps-cafe.db`.
- **Location (production):** Tauri app-data directory, e.g.
  - Windows: `%APPDATA%\com.pscafe.desktop\ps-cafe.db`
  - macOS: `~/Library/Application Support/com.pscafe.desktop/ps-cafe.db`
  - Linux: `~/.local/share/com.pscafe.desktop/ps-cafe.db`
    Never in the installation directory or `dist/`. Updates do not overwrite it.
  - Identifier change notice: `com.pscafe.app` (pre-release) became
    `com.pscafe.desktop` before the first official Windows release. There are
    no deployed installations to migrate; a fresh install uses the new path.
    The internal build (`com.pscafe.desktop.internal`) keeps its own separate
    database.
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

Windows installers are built automatically by GitHub Actions
(`.github/workflows/windows-build.yml`): every push to `main` builds the
production NSIS installer on a `windows-latest` runner and uploads it as a
traceable artifact named `ps-cafe-windows-<short-sha>-run-<run-number>`
(retention: 14 days). Version tags (`v0.1.0`) trigger
`.github/workflows/release.yml`, which attaches `PS-Cafe-Setup-0.1.0.exe` to
the versioned GitHub Release.

To build manually on a Windows 10+ machine (Node 20+, Rust msvc toolchain,
WebView2 runtime, Tauri 2 prerequisites):

1. Clone the repo, run `npm ci`.
2. Run `npm run build:prod:tauri`.
3. The installer appears at `src-tauri/target/release/bundle/nsis/PS Cafe_0.1.0_x64-setup.exe`
   (CI additionally stages a deterministic copy named `PS-Cafe-Setup-0.1.0.exe`).

The production config targets `["dmg", "nsis"]` (each platform builds the
targets it supports; no redundant MSI). The Windows `.exe` cannot be produced
on macOS — macOS builds only verify the frontend, typecheck, Rust checks, and
the DMG path. Windows 10 compatibility (installer identity, x64 arch,
offline-first resources, WebView2 prerequisite) is asserted by the CI verify
step; on-device Windows 10 testing has not been performed in this environment.

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

## Developer Mode (always visible, PIN-gated)

- The developer section in Settings is always visible — in development and
  production builds, on the desktop and on LAN clients. It stays inactive
  until explicitly activated: PIN 2214 is required on every normal →
  Demo-Mode transition.
- Activation installs an ephemeral in-memory demo database —
  demo edits never touch the real `ps-cafe.db`; exiting discards demo data
  and reloads production state. Reloads always default back to normal mode.
- The fixed PIN is an accidental-access barrier for a local tool, not strong
  authentication. Full policy, scenarios, and isolation guarantees are in
  `docs/POST_RELEASE_HARDENING_REPORT.md` (historical) and `docs/DECISIONS.md`.

### Internal desktop build

The developer section no longer needs a special bundle (it is always
visible); the internal build remains available as a **separate testing
bundle** with its own app identity, so internal testing installs as a
distinct application and never touches the production database.

To produce the separate internal desktop (Tauri) app:

```bash
npm run tauri:internal
```

This uses the overlay config `src-tauri/tauri.internal.conf.json`, which:

| Setting              | Production (`tauri.conf.json`) | Internal (`tauri.internal.conf.json`) |
| -------------------- | ------------------------------ | ------------------------------------- |
| `beforeBuildCommand` | `npm run build:prod`           | `npm run build:internal`              |
| `frontendDist`       | `../dist`                      | `../dist-internal`                    |
| `productName`        | `PS Cafe`                      | `PS Cafe Internal`                    |
| `identifier`         | `com.pscafe.desktop`           | `com.pscafe.desktop.internal`         |

Notes:

- The two builds use **separate output directories** (`dist/` vs
  `dist-internal/`) so a normal `npm run build` can never overwrite the
  internal bundle, and vice versa.
- The separate `identifier` gives the internal app its **own app-data
  directory and its own `ps-cafe.db`**, so internal testing never touches
  production data. The internal app is installed and launched as a distinct
  application ("PS Cafe Internal").
- The production config is untouched: `npm run build:prod:tauri` keeps building the
  production app (same always-visible developer section, PIN-gated).
- `dist-internal/` is git-ignored and is never embedded in a production build.

`src/dev/buildConfig.test.ts` asserts this wiring (correct build command,
correct `frontendDist`, and distinct app identity) so a regression fails the
test suite rather than silently shipping the wrong bundle.
