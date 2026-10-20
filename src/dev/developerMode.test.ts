import { beforeEach, describe, expect, it } from "vitest";
import { __resetDbForTests } from "../db/client";
import { __clearMemoryDb } from "../db/memory";
import { DEVELOPER_PIN, verifyDeveloperPin } from "./developerMode";

beforeEach(() => {
  __clearMemoryDb();
  __resetDbForTests();
});

/** Every localStorage value as one string, to assert nothing stores the PIN. */
function localStorageDump(): string {
  const parts: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key !== null) parts.push(key, localStorage.getItem(key) ?? "");
  }
  return parts.join("\n");
}

describe("developer PIN gate", () => {
  it("uses the fixed developer PIN 2214", () => {
    expect(DEVELOPER_PIN).toBe("2214");
    expect(verifyDeveloperPin("2214")).toBe(true);
  });

  it("rejects the previous PIN and other wrong input", () => {
    expect(verifyDeveloperPin("1422")).toBe(false);
    expect(verifyDeveloperPin("0000")).toBe(false);
    expect(verifyDeveloperPin("")).toBe(false);
    expect(verifyDeveloperPin("142")).toBe(false);
    expect(verifyDeveloperPin("22141")).toBe(false);
    expect(verifyDeveloperPin("14a2")).toBe(false);
    expect(verifyDeveloperPin("2214\n")).toBe(true);
  });

  it("trims surrounding whitespace (existing validation contract)", () => {
    expect(verifyDeveloperPin(" 2214 ")).toBe(true);
    expect(verifyDeveloperPin(" 1422 ")).toBe(false);
    expect(verifyDeveloperPin("   ")).toBe(false);
  });

  it("requires the PIN on every activation and never persists it", () => {
    expect(verifyDeveloperPin("0000")).toBe(false);
    expect(verifyDeveloperPin("2214")).toBe(true);
    expect(verifyDeveloperPin("0000")).toBe(false);
    // Verification must not write the PIN (or any auth flag) to storage.
    expect(localStorageDump()).not.toContain("2214");
    expect(localStorageDump()).not.toContain("2214");
  });
});
