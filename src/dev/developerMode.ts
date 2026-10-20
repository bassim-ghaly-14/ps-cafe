/**
 * Developer-mode capability flag.
 *
 * Opt-in via the `VITE_ENABLE_DEVTOOLS=1` environment variable (see
 * package.json scripts and vite.config.ts):
 *   - `npm run dev` / `npm run build:internal` -> devtools available
 *   - `npm run build` (production release)      -> devtools excluded
 *
 * `import.meta.env` is used (rather than a `define` constant) because Vite
 * only substitutes `define` values in production builds — in the dev server
 * the constant is left untouched, which silently hid the toggle locally.
 *
 * The Settings screen renders the Developer Mode section only when this is
 * true. In jsdom/vitest there is no Vite env, so tests can flip it via
 * `__setDevtoolsForTests()`. Production builds must never expose the toggle.
 */
let testOverride: boolean | null = null;

function envFlagEnabled(): boolean {
  try {
    return import.meta.env?.VITE_ENABLE_DEVTOOLS === "1";
  } catch {
    return false;
  }
}

export function isDevtoolsEnabled(): boolean {
  if (testOverride !== null) return testOverride;
  return envFlagEnabled();
}

/** Test-only hook to simulate dev vs production builds. */
export function __setDevtoolsForTests(v: boolean | null): void {
  testOverride = v;
}

/**
 * Accidental-access barrier for the local developer tool — NOT strong
 * authentication and NOT a security boundary. Centralized here so the PIN
 * lives in exactly one place, is never logged, and is easy to change.
 * No remote auth service is involved.
 */
export const DEVELOPER_PIN = "2214";

export function verifyDeveloperPin(input: string): boolean {
  const normalized = (input ?? "").trim();
  if (!/^\d{4}$/.test(normalized)) return false;
  let match = normalized.length === DEVELOPER_PIN.length;
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] !== DEVELOPER_PIN[i]) match = false;
  }
  return match && normalized.length === DEVELOPER_PIN.length;
}
