# Decisions (ADRs)

## ADR-001 — SQLite via tauri-plugin-sql (SQLite driver)

Context: need local relational DB from React with minimal native code.
Options: (a) plugin-sql, (b) custom Rust commands + rusqlite, (c) sidecar.
Decision: (a). Official plugin, maintained for Tauri 2, sufficient transactions for
single-operator app; keeps Rust surface minimal (registration only).
Consequence: grant only `sql:allow-execute`, `sql:allow-select`, `sql:allow-load`.

## ADR-002 — No custom Rust commands in v1

Frontend transactions + partial unique indexes enforce invariants adequately for one
operator. Adding per-operation commands adds surface without benefit. Revisit if
true multi-window concurrency appears.

## ADR-003 — Business day is an explicit session row, never a date

Prevents midnight bugs and matches overnight café reality (18:00→04:00 = one day).
`ended_at_utc IS NULL` = open; partial unique index caps at one open day.

## ADR-004 — Day close blocked while sessions active

Alternatives: auto-stop (risks billing/history corruption), cascade. Rejected.
Block + message is safe, simple, predictable. Enforced in domain guard AND close query.

## ADR-005 — Elapsed = now − startUtc, 1 s display refresh

Tick counters drift when throttled/backgrounded. Timestamp diff is exact; interval only
repaints. Persist duration solely at stop.

## ADR-006 — Active vs completed distinguished in DB, not UI

`ended_at_utc IS NULL` ⇔ active. Recovery query restores timers after any restart.

## ADR-007 — Tab preference in localStorage, not SQLite

UI preference ≠ business record. Key `pscafe.activeTab`, validated against
`{day,stations,settings}`, fallback `day`. Never overrides DB state.

## ADR-008 — Splash 3 s on every full React mount, not on tab switch

Lives at `main.tsx` mount boundary with `MIN_SPLASH_MS=3000`. No fake % bar.
If init slower, splash extends until ready (readiness gate), then fades.

## ADR-009 — No billing fields in v1 schema

Mockup revenue/rate columns excluded deliberately. Adding money later = additive
migration, no rewrite. Keeps v1 focused on time tracking.

## ADR-010 — Windows 10 target, dev on macOS

Dev/verify on macOS; Windows `.exe` via `tauri build` on Windows runner
(GitHub Actions `windows-latest` or local Win10). Never claim unverified builds.
WebView2 runtime noted as prerequisite in installer config.

## ADR-011 — Arabic-first i18n via i18next (ar is default and only v1 locale)

Context: spec mandates Arabic-first RTL UI architected for future languages.
Options: (a) i18next + react-i18next, (b) hand-rolled context, (c) compile-time only.
Decision: (a). Mature, typed-enough, local JSON resources, no runtime network loads.
`ar` is the default and the only shipped locale — no partial English file shipped.
Doc `lang="ar" dir="rtl"` is set in index.html and re-applied before React mounts;
layout uses CSS logical properties. Adding a language = adding
`src/i18n/locales/<lang>/translation.json` + `SUPPORTED_LANGS` entry. No language
selector in v1 (an inert selector is forbidden; a functional one is deferred).

## ADR-012 — Dual persistence backend behind one DbPort interface

Context: UI must be fully exercisable in browser dev and jsdom tests, but
production must use real SQLite through the Tauri plugin.
Decision: `db/port.ts` defines execute/select; `db/client.ts` picks the Tauri
plugin-sql backend at runtime inside Tauri and a localStorage-backed interpreter
of the exact SQL subset used by repositories outside it. Both enforce the same
constraints (partial-unique violations throw). Repositories never know which
backend is active. Production database is always real SQLite in the app-data dir.

## ADR-013 — Day-close block names the offending stations

The mockup force-stopped devices with confirm(); v1 rejects the close instead
(ADR-004). The rejection lists the active station names so the operator knows
exactly what to stop on the الأجهزة tab, then can retry. Never auto-stops.

## ADR-014 — Single shared ticker for all live timers

`useNow` runs one 1 s interval at the screen level; cards receive `now` as a
prop. Avoids N independent intervals on the stations grid; timers still derive
from `started_at_utc`, never from tick counts (ADR-005).

## ADR-015 — No club-name setting in v1

The mockup's "club name" field had no functional purpose (branding hardcoded in
i18n). Adding a settings field that changes nothing visible is rejected; can be
added later with a real consumer.

## ADR-016 — Developer Mode: ephemeral isolated demo DB + compile-time flag

Context: test the full operational UI without touching real cafe data.
Decision: PIN-gated (2214, required every activation, centralized in
`src/dev/developerMode.ts`) section in Settings, compiled in only when
`VITE_ENABLE_DEVTOOLS=1` (`npm run dev`, `npm run build:internal`).
Activation installs an ephemeral in-memory demo DB (production schema +
scenario seed) via `setDbOverride()`; every repository resolves through
`getActiveDb()`. Exit/reload discards demo and reloads production.
Consequence: demo edits can never contaminate production; production
`npm run build` has no toggle. The PIN is an accidental-access barrier,
not authentication — documented, never logged, no remote auth.

### ADR-016a — Internal desktop build overlay

Context: the developer section is compile-time gated, so a _desktop_ build
also needs a gated variant; the production desktop app must keep the toggle
compiled out.
Decision: `src-tauri/tauri.internal.conf.json` overlays the base Tauri config
with `beforeBuildCommand: npm run build:internal`, `frontendDist:
../dist-internal`, and a distinct app identity (`PS Cafe Internal` /
`com.pscafe.app.internal`). Built via `npm run tauri:internal`. The two builds
use separate frontend output dirs (`dist/` vs `dist-internal/`) so neither can
overwrite the other's bundle, and the distinct `identifier` gives the internal
app its own app-data dir and its own `ps-cafe.db`.
Consequence: the production config is untouched (`npx tauri build` still
ships the toggle-free app), internal testing never touches production data,
and the internal app installs as a separate application. `src/dev/buildConfig.test.ts`
pins this wiring so a regression fails CI rather than shipping the wrong bundle.

### ADR-016b — Developer Mode always visible; PIN 2214 (supersedes the visibility parts of ADR-016/016a)

Context: the compile-time `VITE_ENABLE_DEVTOOLS` gate and the LAN-client gate
in Settings hid the Developer Mode section in production builds and on paired
phones, and PIN 2214 was published in the docs.
Decision: the section always renders (development + production builds,
desktop + LAN client). `isDevtoolsEnabled()` / `__setDevtoolsForTests()` were
removed and the `!isLanClient()` wrapper around the section was dropped.
Activation stays behind the centralized PIN — changed to 2214, still required
on every normal -> developer transition, never persisted, never logged.
Demo Mode still starts inactive on every launch and still runs on an isolated
ephemeral DB via `setDbOverride()`; the internal build (ADR-016a) remains only
as a separate bundle/profile.
Consequence: visibility no longer implies capability. The PIN is still an
accidental-access barrier, not a security boundary. LAN clients see the
section, but the LAN-restricted database reset stays hidden and blocked
(`LAN_CLIENT`), and demo activation on a client is a purely local sandbox
that never reaches the gateway or the desktop database.

## ADR-020 — Per-device hourly pricing + proportional revenue (supersedes ADR-009)

Context: business owner wants per-device hourly rate and device-level revenue
history; ADR-009 excluded billing fields in v1. Adding pricing now is additive
and backward-compatible.
Decision:

- Schema v2: `stations.hourly_rate_minor INTEGER NOT NULL DEFAULT 0` (0 = unpriced,
  never guessed) + `rental_sessions.rate_minor_at_start INTEGER NULL`
  (NULL = pre-pricing legacy).
- Start snapshots `stations.hourly_rate_minor` into `rate_minor_at_start`;
  snapshot is immutable — later rate edits never touch prior sessions.
- Revenue = round(duration_ms * rate_minor_at_start / 3_600_000), billed to the
  second, proportional. No minimum charge, no rounding-up of partial hours, no
  grace period, no discounts, no taxes (none exist in v1). Revenue is amount
  attributable at the recorded rate, not collected payment.
- Integer minor units only; no float arithmetic. Legacy NULL-snapshot sessions
  count toward time/session totals but NOT revenue (honest about unavailable
  history).
  Consequence: old sessions remain at old rate; price changes are prospective only;
  device details page shows revenue/operating-time/session count scoped to one
  station id; running session is billed at its start snapshot.
