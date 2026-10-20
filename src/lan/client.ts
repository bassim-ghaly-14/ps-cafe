import { clearLanToken, readLanToken, writeLanToken } from "../db/http";

/**
 * Phone-side pairing helpers. The QR payload is `{base}#k={token}`:
 * the token is captured from the URL fragment once, persisted to
 * sessionStorage (per-tab), and scrubbed from the address bar so it
 * never leaks via history sync, screenshots of the URL bar, or referrers.
 */

export function tokenFromFragment(hash: string): string | null {
  const m = /(?:^|#|&)k=([^&]+)/.exec(hash);
  if (!m) return null;
  try {
    const token = decodeURIComponent(m[1] ?? "");
    return /^pscafe_[0-9a-f]{32}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

/** Capture `#k=` once at boot; returns true when a token was stored. */
export function captureLanTokenFromUrl(): boolean {
  try {
    const hash = window.location.hash;
    const token = tokenFromFragment(hash);
    if (!token) return false;
    writeLanToken(token);
    // Scrub the fragment but keep deep-link hashes intact (none expected
    // on first pair; pairing links carry only #k=...).
    const clean = hash.replace(/([#&])k=[^&]*/g, "").replace(/^#&/, "#");
    const url = `${window.location.pathname}${window.location.search}${clean === "#" ? "" : clean}`;
    window.history.replaceState(null, "", url);
    return true;
  } catch {
    return false;
  }
}

export function isLanClientUrl(): boolean {
  try {
    return (window as unknown as Record<string, unknown>).__PSCAFE_LAN__ === 1;
  } catch {
    return false;
  }
}

export { clearLanToken, readLanToken };
