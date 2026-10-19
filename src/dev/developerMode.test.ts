import { beforeEach, describe, expect, it } from "vitest";
import { __resetDbForTests } from "../db/client";
import { __clearMemoryDb } from "../db/memory";
import {
  __setDevtoolsForTests,
  isDevtoolsEnabled,
  verifyDeveloperPin,
} from "./developerMode";

beforeEach(() => {
  __clearMemoryDb();
  __resetDbForTests();
  __setDevtoolsForTests(null);
});

describe("developer PIN gate", () => {
  it("accepts the correct PIN", () => {
    expect(verifyDeveloperPin("2214")).toBe(true);
  });
  it("rejects wrong PINs and keeps mode disabled", () => {
    expect(verifyDeveloperPin("0000")).toBe(false);
    expect(verifyDeveloperPin("")).toBe(false);
    expect(verifyDeveloperPin("221")).toBe(false);
    expect(verifyDeveloperPin("22145")).toBe(false);
    expect(verifyDeveloperPin(" 2214 ")).toBe(true);
  });
  it("requires PIN on every activation (no persisted auth flag)", () => {
    expect(verifyDeveloperPin("0000")).toBe(false);
    expect(verifyDeveloperPin("2214")).toBe(true);
    expect(verifyDeveloperPin("0000")).toBe(false);
  });
});

describe("devtools build flag", () => {
  it("disabled by default (production hides developer tools)", () => {
    expect(isDevtoolsEnabled()).toBe(false);
  });
  it("enabled in dev/internal builds via test override", () => {
    __setDevtoolsForTests(true);
    expect(isDevtoolsEnabled()).toBe(true);
    __setDevtoolsForTests(false);
    expect(isDevtoolsEnabled()).toBe(false);
  });
});
