/**
 * Developer Mode PIN — the single authoritative location for the Developer
 * PIN and its verification. The Settings screen requires this PIN on every
 * normal -> developer (Demo Mode) transition before activation is attempted.
 *
 * This is an accidental-access barrier for a local tool — NOT strong
 * authentication and NOT a security boundary. The PIN is never persisted,
 * never stored in local/session storage, never logged, and no remote auth
 * service is involved.
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
