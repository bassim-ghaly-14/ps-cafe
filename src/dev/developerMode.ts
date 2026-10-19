/**
 * Developer-mode capability flag.
 *
 * Compiled via Vite `define.__DEVTOOLS_ENABLED__` (see vite.config.ts):
 *   - `npm run dev` / `npm run build:internal` -> true  (devtools available)
 *   - `npm run build` (production release)     -> false (devtools excluded)
 *
 * The Settings screen renders the Developer Mode section only when this is
 * true. In jsdom/vitest there is no Vite define, so tests can flip it via
 * `__setDevtoolsForTests()`. Production builds must never expose the toggle.
 */
declare const __DEVTOOLS_ENABLED__: boolean | undefined;

let testOverride: boolean | null = null;

export function isDevtoolsEnabled(): boolean {
  if (testOverride !== null) return testOverride;
  try {
    return (
      typeof __DEVTOOLS_ENABLED__ !== "undefined" &&
      __DEVTOOLS_ENABLED__ === true
    );
  } catch {
    return false;
  }
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
