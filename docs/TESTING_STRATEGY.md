# Testing Strategy — actual implemented suite (80 tests, all green)

Run with `npm test` (Vitest, jsdom environment).

## Level 1 — Domain unit (no DB)
`src/domain/guards.test.ts` — canOpenDay/canCloseDay truth table; time utils:
elapsed clamp on backward clock, finalizeDurationMs rejects end < start,
formatHMS edge cases (0, 01:23:40, 25 h+ unbounded hours), timestamp-diff proof
(5020 ms gap → `00:00:05` regardless of tick count), tab-key validation fallback.
`src/domain/rentalSession.test.ts` — canStartSessionDetailed codes
(DAY_CLOSED/STATION_INACTIVE/STATION_BUSY/OK), canStopSession, station-name
validation (trim, 1–60 chars), hex-color validation.

## Level 2 — DB interpreter + repository integration
`src/db/memory.test.ts` — memory backend enforces the same constraints as SQLite:
default station seed, open/close day, second-open-day rejected (UNIQUE), close
with active session rejected, atomic start/stop with duration persisted,
duplicate active session rejected (UNIQUE), negative-duration stop rejected,
migration ledger idempotent across port instances.
`src/repositories/businessDayRepo.test.ts` — full repo flows: no open day on
fresh DB, open + reject second, descending history order, close with exact end
timestamp, closed-day counting, history preservation, session start on eligible
station, reject start with no open day, duplicate-start rejection, stop persists
duration, stop of nonexistent session rejected, active-session recovery list,
per-day aggregates (count + totalMs), all-time aggregates.

## Level 3 — UI integration (RTL + jsdom)
`src/hooks/ui.test.tsx` — full App mounts against the memory backend:
- **RTL/i18n:** `documentElement.lang === 'ar'`, `dir === 'rtl'`; splash shows
  Arabic title/tagline within the 3 s minimum and is replaced after; bottom nav
  renders exactly three Arabic labels in RTL order (يوم العمل, الأجهزة, الإعدادات).
- **Business-day workflow:** open shows live open pill + HH:MM:SS clock + close
  button; close opens confirmation dialog; confirming closes and returns to
  closed pill.
- **Stations workflow:** start disabled while day closed (with Arabic lock
  notice); start→running tag (شغال)→stop→idle tag (فاضي) round-trip; closing a
  day while a station runs shows the Arabic blocked message and keeps the day open.
- **Tab persistence:** selected tab saved to localStorage and restored after a
  simulated reload; invalid persisted value falls back to يوم العمل.
- **Scope guards:** no `<footer>` element; exactly three nav destinations.

## Level 4 — Desktop verification (macOS, this environment)
- `cargo check` and `npx tauri build` succeed.
- Bundled `.app` smoke-tested: launches, stays alive, creates `ps-cafe.db` in the
  Tauri app-data dir with schema_meta v1 and 4 correctly-named Arabic stations
  (verified via sqlite3 CLI).
- Offline: `dist/` scanned for remote URLs — none fetched at runtime; no CDN
  fonts or assets.

## Level 5 — Windows release (not executable here)
`npx tauri build` on Windows 10 produces the NSIS `.exe`; smoke per
README "Building for Windows 10". Never claim untested Windows builds (ADR-010).

## Timer accuracy proof
`elapsedMs(t0, t0 + 5020)` → `formatHMS` → `00:00:05` with zero intervening
ticks, demonstrating display derives from timestamps, not tick accumulation.

## Post-release hardening (Task 1–4)
`src/repositories/timerRecovery.test.ts` — deterministic recovery regression:
open-day elapsed after simulated downtime (75 min → exact ms), midnight span
with no date logic, closed days stay closed, repeated init creates no
duplicates, invalid timestamps clamp to 0 (never negative), active sessions
recover with per-station independence (60/50/40 min), startup creates no
duplicate sessions.
`src/dev/developerMode.test.ts` — PIN gate (correct accept, wrong reject,
required every activation), devtools flag off by default (production hides
toggle) and on via override (dev/internal builds).
`src/dev/demoIsolation.test.ts` — demo mutations never touch production,
repositories resolve the override while active, exit reloads real state,
seed consistency per scenario, reset restores seed state, statistics come
only from demo records while active.
`src/hooks/ui.test.tsx` additions — Settings actions show icon + Arabic
label with accessible names; developer section hidden in production builds,
visible + PIN-gated in dev builds (masked numeric input, Arabic wrong-PIN
message, banner on activation).

