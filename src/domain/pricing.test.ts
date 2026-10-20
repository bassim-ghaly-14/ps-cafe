import { describe, expect, it } from "vitest";
import {
  formatRateMajor,
  normalizeRateInput,
  parseHourlyRateInput,
  sessionRevenueMinor,
  validateHourlyRateMinor,
} from "./pricing";

describe("hourly rate validation (minor units)", () => {
  it("accepts zero and normal values", () => {
    expect(validateHourlyRateMinor(0)).toBe(true);
    expect(validateHourlyRateMinor(2500)).toBe(true);
    expect(validateHourlyRateMinor(1_000_000)).toBe(true);
  });
  it("rejects negatives, fractions, NaN, Infinity, overflow", () => {
    expect(validateHourlyRateMinor(-1)).toBe(false);
    expect(validateHourlyRateMinor(12.5)).toBe(false);
    expect(validateHourlyRateMinor(Number.NaN)).toBe(false);
    expect(validateHourlyRateMinor(Number.POSITIVE_INFINITY)).toBe(false);
    expect(validateHourlyRateMinor(1_000_001)).toBe(false);
    expect(validateHourlyRateMinor("25" as unknown as number)).toBe(false);
  });
});

describe("rate input parsing (EGP major -> minor)", () => {
  it("parses integer and decimal input", () => {
    expect(parseHourlyRateInput("25")).toEqual({
      ok: true,
      code: "OK",
      minor: 2500,
    });
    expect(parseHourlyRateInput("25.5")).toEqual({
      ok: true,
      code: "OK",
      minor: 2550,
    });
    expect(parseHourlyRateInput("0")).toEqual({
      ok: true,
      code: "OK",
      minor: 0,
    });
  });
  it("rejects empty input instead of coercing to zero", () => {
    expect(parseHourlyRateInput("").ok).toBe(false);
    expect(parseHourlyRateInput("").code).toBe("RATE_REQUIRED");
    expect(parseHourlyRateInput("   ").code).toBe("RATE_REQUIRED");
  });
  it("rejects negative, malformed, and over-precise input", () => {
    expect(parseHourlyRateInput("-5").ok).toBe(false);
    expect(parseHourlyRateInput("abc").code).toBe("RATE_INVALID");
    expect(parseHourlyRateInput("25.555").ok).toBe(false);
    expect(parseHourlyRateInput("NaN").ok).toBe(false);
    expect(parseHourlyRateInput("1e3").ok).toBe(false);
    expect(parseHourlyRateInput("10001").code).toBe("RATE_OUT_OF_RANGE");
  });
  it("normalizes Arabic-Indic digits", () => {
    expect(normalizeRateInput("٢٥.٥")).toBe("25.5");
    expect(parseHourlyRateInput("٢٥").minor).toBe(2500);
  });
  it("round-trips through formatRateMajor", () => {
    expect(formatRateMajor(2500)).toBe("25");
    expect(formatRateMajor(2550)).toBe("25.5");
    expect(parseHourlyRateInput(formatRateMajor(2575)).minor).toBe(2575);
  });
});

describe("session revenue (proportional, integer math)", () => {
  it("bills one hour at exactly the hourly rate", () => {
    expect(sessionRevenueMinor(3_600_000, 2500)).toBe(2500);
  });
  it("bills partial hours proportionally to the second", () => {
    expect(sessionRevenueMinor(1_800_000, 2500)).toBe(1250);
    expect(sessionRevenueMinor(60_000, 2500)).toBe(42);
  });
  it("returns null for legacy NULL snapshots instead of fabricating", () => {
    expect(sessionRevenueMinor(3_600_000, null)).toBeNull();
  });
  it("returns null for invalid durations", () => {
    expect(sessionRevenueMinor(null, 2500)).toBeNull();
    expect(sessionRevenueMinor(-5, 2500)).toBeNull();
    expect(sessionRevenueMinor(Number.NaN, 2500)).toBeNull();
  });
});
