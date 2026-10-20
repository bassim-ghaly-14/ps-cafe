# Architecture — PS Café

## 1. Layers (responsibilities, not file-per-function)

```
Presentation   screens/, components/             — render + events only, no SQL, no rules
Application    hooks/                            — orchestration, timers, splash/tab lifecycle
Domain         domain/                          — entities, transitions, validation (pure, tested)
Infrastructure db/, repositories/               — SQL, migrations, backend selection
Shared         utils/, i18n/, constants/         — formatting, time math, translations, tab keys
Rust           src-tauri/src/                   — app setup, plugin registration; no per-op commands in v1
```

**Dependency direction:** Presentation → Application → Domain ← Infrastructure.
Components never import from `db/` or `repositories/` directly; they use hooks.
Domain never imports SQL, Tauri APIs, or React.

## 2. Source directory structure (final)

```
src/
  main.tsx                 entry: awaits i18n readyPromise, applies RTL, mounts App
  App.tsx                  shell: splash gate (3 s) + tab restore + screens + BottomNav
  i18n/
    index.ts               i18next init (ar default, nsSeparator false, keySeparator '.'),
                           applyDocumentLocale(), exported readyPromise
    locales/ar/translation.json  ALL user-facing Arabic strings (single source of truth)
  screens/
    BusinessDayScreen.tsx  live clock, open/close + confirmation, blocked-close panel,
                           history table, 4 stat cards (real aggregates)
    StationsScreen.tsx     station grid + lock notice when day closed
    SettingsScreen.tsx     station add/rename/recolor/show-hide/activate + confirmations
  components/
    BottomNav.tsx          3 items, Lucide icons, Arabic labels, RTL order, active state
    Splash.tsx             3 s brand animation, no fake %, Arabic via i18n
    StatCard.tsx           label + value
    StationCard.tsx        idle/running states, live timer, per-day footer
    ConfirmDialog.tsx      app-styled modal (no browser alert/confirm anywhere)
    PinDialog.tsx          masked numeric PIN gate for Developer Mode
    DeveloperSection.tsx   PIN-gated demo controls (always visible; Demo Mode starts inactive)
  hooks/
    useCafe.ts             useCafeData (state + refresh) + useCafeActions (all mutations
                           with domain re-validation, error codes → i18n keys)
    useNow.ts              single shared 1 s ticker for all live timers
  domain/
    businessDay.ts         canOpenDay, canCloseDay(activeSessions)
    rentalSession.ts       canStartSessionDetailed, canStopSession, name/color validation
    types.ts               BusinessDay, Station, RentalSession, ActiveTab (strict)
  repositories/
    businessDayRepo.ts     SQL for business_days (open/close/list/count)
    stationRepo.ts         SQL for stations (list/get/create/update, soft flags only)
    sessionRepo.ts         SQL for rental_sessions (start/stop/active/aggregates)
  db/
    port.ts                DbPort interface + typed RepoError
    client.ts              backend selection (Tauri SQLite vs memory), getActiveDb
                           (routes to isolated demo DB when Developer Mode is
                           active via setDbOverride), migrations, seed
    memory.ts              localStorage/ephemeral interpreter of the SQL subset used by repos
    migrations.ts          versioned DDL (v1); schema.sql mirrors it
  dev/
    developerMode.ts       Developer PIN verify (PIN 2214, never persisted)
    demoSeed.ts            demo scenario constants + raw seeding helpers (open/close day,
                           completed session) — same SQL + constraints as production
    demoMode.ts            build/enter/reseed/exit demo DB, seed scenarios
                           (full/empty/open-empty/open-busy/blocked-close/closed-history),
                           validateDemoConsistency
  utils/
    time.ts                elapsedMs, finalizeDurationMs, formatHMS (timestamp-diff only)
    format.ts              locale-aware date/number/hour formatting (ar default)
  constants.ts             tab keys, splash duration, storage keys
  test/setup.ts            jest-dom setup for RTL
src-tauri/
  src/main.rs              tauri::Builder + plugin_sql::Builder, no custom commands
  tauri.conf.json          app id, window, bundler targets [app, dmg, nsis]
  capabilities/default.json minimal sql permissions only
```

## 3. Integration boundaries

- **React ↔ SQLite:** only via `repositories/*` calling the `DbPort` from `db/client.ts`.
  Inside Tauri the port wraps plugin-sql (real SQLite, app-data dir); outside Tauri it
  wraps the memory interpreter. No raw `execute/select` in screens/hooks.
- **React ↔ Rust:** plugin registration only in v1. Add `#[tauri::command]` later only if
  an invariant cannot be enforced from the frontend layer (documented ADR required).
- **Time:** persist `INTEGER` UTC millis; compute `elapsed = now - startUtc`; one shared
  1 s interval repaints; never accumulate ticks.
- **State:** local `useState/useEffect` + explicit refetch after each mutation. No
  global state library.
- **UI preference vs business state:** active tab in `localStorage` (`pscafe.activeTab`);
  business truth always re-read from the database on launch.

## 4. Error handling

Repositories throw typed `RepoError { code, message }`; `useCafeActions` maps codes to
i18n keys; screens show inline notices or dialogs, never silent fail. Mutations
re-validate preconditions so double-clicks/retries cannot create duplicates (partial
unique indexes as last line of defense). DB init failure renders a full Arabic error
screen with a retry action.

## 5. i18n rules

All user-facing strings live in `src/i18n/locales/ar/translation.json`. Components call
`t('section.key')`. Never hardcode Arabic (or English) literals in JSX. Future language:
add `locales/<lang>/translation.json` + `SUPPORTED_LANGS` entry; no component changes.

## 6. Rules for future features

1. New rule → `domain/` + unit test first. 2. New persistence → migration + repo method.
2. New screen → hook + screen, never SQL in component. 4. New dep → ADR in DECISIONS.md.
3. New string → translation JSON only.

## 7. Anti-patterns (forbidden)

SQL in components; tick-accumulated timers; calendar-date as day id; footer element;
top tabs; emoji icons; `any`/assertions for domain types; broad Tauri capabilities;
in-memory SQLite for production; DB file under `src/`; auto open/close of days or
sessions; force-closing sessions on day close; hardcoded user-facing strings outside
translation resources; browser alert/confirm.
Per-device hourly pricing IS permitted (see docs/DECISIONS.md ADR-020) under the rules:
rate stored as integer minor units; session rate snapshot at start; revenue proportional
to duration using each session's own snapshot; historical sessions never recalculated.
