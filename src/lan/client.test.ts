import { describe, expect, it } from "vitest";
import { tokenFromFragment } from "./client";

describe("lan client token capture", () => {
  it("extracts a valid token from the fragment", () => {
    const token = `pscafe_${"a".repeat(32)}`;
    expect(tokenFromFragment(`#k=${token}`)).toBe(token);
  });

  it("rejects malformed tokens", () => {
    expect(tokenFromFragment("#k=short")).toBeNull();
    expect(tokenFromFragment("#/stations/1")).toBeNull();
    expect(tokenFromFragment("")).toBeNull();
    expect(tokenFromFragment("#k=pscafe_" + "z".repeat(32))).toBeNull();
  });

  it("finds k= among other fragment params", () => {
    const token = `pscafe_${"b".repeat(32)}`;
    expect(tokenFromFragment(`#/x&k=${token}`)).toBe(token);
  });
});
