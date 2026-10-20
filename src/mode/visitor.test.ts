import { afterEach, describe, expect, it } from "vitest";
import {
  getAccessMode,
  isDesktopRuntime,
  isLanRuntime,
  isReadOnly,
  isVisitor,
  READ_ONLY_CODE,
} from "./visitor";

/**
 * Visitor-mode detection.
 *
 * The mode is *derived* from the runtime, never toggled by the UI:
 *   - Tauri webview            -> "desktop"    (full read/write)
 *   - page served by the LAN   -> "visitor"    (permanently read-only)
 *     gateway (`__PSCAFE_LAN__`)
 *   - anything else (plain      -> "standalone" (own local database)
 *     browser / dev preview)
 */
describe("visitor mode detection", () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__PSCAFE_LAN__;
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    delete (window as unknown as Record<string, unknown>).__TAURI__;
  });

  it("is standalone in a plain browser (no Tauri, no LAN marker)", () => {
    expect(getAccessMode()).toBe("standalone");
    expect(isReadOnly()).toBe(false);
    expect(isVisitor()).toBe(false);
  });

  it("is a visitor when the LAN gateway served the page", () => {
    (window as unknown as Record<string, unknown>).__PSCAFE_LAN__ = 1;
    expect(isLanRuntime()).toBe(true);
    expect(getAccessMode()).toBe("visitor");
    expect(isReadOnly()).toBe(true);
    expect(isVisitor()).toBe(true);
  });

  it("is desktop inside the Tauri webview, even with the LAN marker", () => {
    (window as unknown as Record<string, unknown>).__PSCAFE_LAN__ = 1;
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(isDesktopRuntime()).toBe(true);
    // The desktop webview is never a visitor: full write access.
    expect(getAccessMode()).toBe("desktop");
    expect(isReadOnly()).toBe(false);
  });

  it("exposes the shared READ_ONLY_MODE error code", () => {
    // Must match the Rust gateway's error code exactly.
    expect(READ_ONLY_CODE).toBe("READ_ONLY_MODE");
  });
});
