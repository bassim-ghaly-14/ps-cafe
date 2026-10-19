# Implementation Plan — three phases

All three phases are COMPLETE. Actual outcomes recorded below.

## Phase 1 — Foundation & Persistence ✅ DONE
**Objective:** stable offline foundation with migrations working, no business UI yet.
**Includes:** Vite+React+TS strict scaffold, Tauri 2 config + minimal capabilities,
SQLite plugin wiring, `db/client.ts`, `migrations.ts`, `schema.sql`, domain types +
pure guards, `utils/time.ts`, splash + bottom-nav shell, Vitest harness.
**Files/areas:** `src/db/*`, `src/domain/types.ts`, `src/utils/*`, `src-tauri/*`,
`src/components/Splash.tsx`, `src/components/BottomNav.tsx`, `src/App.tsx`.
**Acceptance (verified):** `npm run typecheck` clean; `npm test` passes;
`npm run build` succeeds; `cargo check` passes; DB file created under app-data
dir on desktop launch (verified: `~/Library/Application Support/com.pscafe.app/ps-cafe.db`);
splash shows 3 s and restores tab (verified in UI tests).
**Out of scope:** open/close day, start/stop session, stats, settings CRUD.

## Phase 2 — Core Operational Workflows ✅ DONE
**Objective:** the working café loop on top of Phase-1 persistence.
**Implemented:**
- `src/db/port.ts` — DbPort interface + RepoError; `src/db/client.ts` — dual
  backend: Tauri plugin-sql in production, localStorage-backed memory interpreter
  in browser/tests (same SQL subset, same constraints); versioned migrations in
  `src/db/migrations.ts`; first-run seed of 4 Arabic station cards.
- Repositories: `businessDayRepo.ts`, `stationRepo.ts`, `sessionRepo.ts` — all SQL
  isolated here, zero SQL in components/hooks.
- Hooks: `useCafe.ts` (state + all mutations with domain re-validation),
  `useNow.ts` (single shared 1s ticker for all live timers).
- Screens: `BusinessDayScreen` (live clock, open/close with confirmation dialog,
  blocked-close message naming active stations, history table, 4 stat cards from
  real aggregates), `StationsScreen` + `StationCard` (colored cards, running glow,
  live HH:MM:SS, per-day footers), `SettingsScreen` (add/rename/recolor/show-hide/
  activate stations with confirmations, no deletion).
- Arabic-first i18n: `src/i18n/` (i18next, ar default + only locale, local JSON,
  doc `lang=ar dir=rtl` applied before first paint, `readyPromise` gate).
- Policies enforced in domain + SQL + repo layers: one open day (partial unique
  index), one active session per station (partial unique index), close blocked
  while sessions active (guard + query + memory interpreter), no billing.
**Acceptance (verified):** open→start→stop→close persists across restart
(recovery from `ended_at_utc IS NULL` rows); live timer = now − start timestamp;
double-start rejected; day-close blocked with Arabic message naming stations;
history + stat cards computed from records; 57 tests green; production desktop
build launches and seeds correct data.

## Phase 3 — Configuration Hardening & Distributable ✅ DONE (with platform caveat)
**Objective:** safe configuration + verified artifact.
**Implemented:**
- Settings CRUD guards: cannot deactivate a running station; renaming/deactivation
  never deletes history (soft flags only); name validation (1–60 chars, unique);
  color validated as #RRGGBB; confirmation dialog for deactivation.
- Persistence tests: reload survival (memory port persists to storage between
  port instances), active-session recovery, migration idempotency, constraint
  failure handling, aggregate correctness.
- UI tests: 3 s splash on full mount only (not on tab switch), tab persistence +
  invalid-value fallback, RTL nav order, no footer, exactly 3 destinations,
  blocked-close flow, station start/stop flow.
- Offline verification: dist bundle scanned — only doc-comment URLs in React
  internals (never fetched); no CDN fonts, no remote assets; all icons local.
- Production build verified: `npx tauri build` produces macOS `.app` (13 MiB)
  and `.dmg` (4.17 MiB); binary smoke-tested (launches, stays alive, creates
  DB in app-data dir with correct schema v1 and seeded stations).
- Config: bundle targets `["app", "dmg", "nsis"]` — NSIS produces the Windows
  `.exe` installer when built on Windows 10+ (cannot be produced or executed
  from macOS; exact Windows build procedure documented in README).
**Known limitation:** Windows NSIS artifact was NOT built or tested in this
environment (macOS). The same `npx tauri build` on Windows 10 with Node 20+,
Rust stable, and MSVC build tools produces `src-tauri/target/release/bundle/nsis/*.exe`.
**Out of scope (deferred by scope decision):** billing/pricing (ADR-009),
club-name setting (no functional purpose in v1), charts, sync.

