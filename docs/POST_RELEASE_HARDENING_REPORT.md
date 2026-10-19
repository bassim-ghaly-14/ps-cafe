Date: 2026-10-19. Baseline: 57 tests green, typecheck/lint/build green.

## 1. Timer recovery

Root cause: the core formula was already correct
(elapsed = now - started_at_utc, shared 1s repaint ticker). Gaps were
defensive: (1) no sanitizer for corrupt persisted timestamps; (2) memory
interpreter rejected boolean flags and lacked the 5-param station insert;
(3) no deterministic restart-regression tests.

Fix: elapsedMs returns 0 for invalid timestamps; new isValidTimestamp +
clockJumpInfo encode the policy (backward jump clamps to 00:00:00, never
negative). getOpenDay/getActiveSession/listActiveSessions filter invalid
rows (never delete history). client.ts getActiveDb is the single
resolution point; setDbOverride/isDemoDbActive/createIsolatedDemoDb manage
the demo DB; errors never fall back across modes. memory.ts accepts 0/1 +
boolean flags, the 5-param station insert, and ephemeral ports.

Startup: SQLite init, migrations, load open day + active sessions,
hydrate, derive display via persisted timestamps, render. Splash gates on
readiness with a 3s minimum. No auto-close, no rewrites, no recreation.
18:00 start, off 1h, reopen 19:15 shows 01:15:00 (tested exact ms).
Clock limitation preserved honestly: wall-clock only, no monotonic claim.

## 2. Developer Mode

Enable: npm run dev sets VITE_ENABLE_DEVTOOLS=1; Settings shows the
developer section. Production npm run build compiles it out.
Internal build: npm run build:internal (devtools ON, separate profile).

PIN: enable opens PinDialog (masked, numeric, Enter/Esc). Wrong PIN shows
an Arabic message and stays disabled. Correct PIN 2214 activates. PIN
required on every transition; never persisted. Centralized in
developerMode.ts; accidental-access barrier, NOT authentication.

Isolation: ephemeral in-memory demo DB + migrations + scenario seed,
installed via setDbOverride. All repos resolve via getActiveDb. Reload
defaults to normal mode; exit discards demo and reloads production. No
cross-mode fallback on errors.

Scenarios: full, empty, open-empty, open-busy, blocked-close,
closed-history. Selector + confirmed reset + exit; banner pill while
active. Production exclusion via compile-time __DEVTOOLS_ENABLED__.
Demo data is ephemeral by design.

## 3. Settings actions

Pencil + edit, Palette + changeColor (new key), Eye/EyeOff + show/hide,
Power/PowerOff + activate/deactivate, Plus + add (icon carries the plus),
Code2 + developer section. Icon+label with aria-label + title, RTL order
preserved, dark theme untouched.

## 4. Verification

typecheck PASS; lint PASS; npm test 80/80 PASS; npm run build PASS;
cargo check PASS. Windows exe NOT built here (macOS env; see README).
No billing reintroduced; Arabic/RTL/splash/tab-restore/offline intact.

Manual restart check: open day, start 2 stations, quit, wait N minutes,
relaunch. Both timers must advance by N minutes with no operator action.
