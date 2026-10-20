/**
 * Centralized visitor-mode state.
 *
 * A "visitor" is a browser served by the desktop's LAN gateway (a paired
 * phone). Visitors are strictly read-only: the Rust gateway rejects every
 * mutation before it reaches SQLite, and the desktop app keeps full write
 * behaviour through Tauri.
 *
 * This module is the single frontend source of truth for that fact. It is
 * intentionally *derived* from the runtime rather than toggled by the UI:
 * there is no way for a visitor to opt into write mode, and no code path
 * that flips it. The Rust backend is the real enforcement point; this is
 * the UX layer that disables controls before a request is ever made.
 */

/**
 * How the current page is talking to the database.
 *
 * - `desktop` — the Tauri app: full read/write.
 * - `visitor` — a browser served by the LAN gateway: read-only.
 * - `standalone` — a plain browser (dev/preview): local, isolated.
 */
export type AccessMode = "desktop" | "visitor" | "standalone";

/** True when the page is running inside the Tauri webview. */
export function isDesktopRuntime(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
    );
  } catch {
    return false;
  }
}

/**
 * True when the page was served by the desktop's LAN gateway — the server
 * injects `window.__PSCAFE_LAN__ = 1` into the served `index.html`.
 */
export function isLanRuntime(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      (window as unknown as Record<string, unknown>).__PSCAFE_LAN__ === 1
    );
  } catch {
    return false;
  }
}

/**
 * The current access mode.
 *
 * The Tauri check comes first: the desktop webview is never a visitor,
 * even if the page happens to be loaded through a LAN URL.
 */
export function getAccessMode(): AccessMode {
  if (isDesktopRuntime()) return "desktop";
  if (isLanRuntime()) return "visitor";
  return "standalone";
}

/**
 * True when mutations must not be attempted.
 *
 * Visitors are read-only. `standalone` (plain browser preview) keeps its
 * own local database, so it is not a visitor and may still write locally.
 */
export function isReadOnly(): boolean {
  return getAccessMode() === "visitor";
}

/** Convenience alias for `isReadOnly()`, used by mutation surfaces. */
export function isVisitor(): boolean {
  return isReadOnly();
}

/**
 * Reason a mutation was refused, in a code the UI can branch on.
 * Matches the Rust gateway's error code so both sides agree.
 */
export const READ_ONLY_CODE = "READ_ONLY_MODE";
