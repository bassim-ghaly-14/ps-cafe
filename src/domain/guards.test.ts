import { describe, expect, it } from "vitest";
import {
  canCloseDay,
  canOpenDay,
  canStartSession,
} from "../domain/businessDay";
import { elapsedMs, finalizeDurationMs, formatHMS } from "../utils/time";
import { parseActiveTab } from "../constants";

describe("business-day guards", () => {
  it("blocks opening when one is already open", () => {
    expect(canOpenDay(true).ok).toBe(false);
    expect(canOpenDay(false).ok).toBe(true);
  });
  it("blocks closing while sessions are active", () => {
    expect(canCloseDay(2).ok).toBe(false);
    expect(canCloseDay(0).ok).toBe(true);
  });
  it("blocks station start when day closed or station busy", () => {
    expect(canStartSession(false, false).ok).toBe(false);
    expect(canStartSession(true, true).ok).toBe(false);
    expect(canStartSession(true, false).ok).toBe(true);
  });
});

describe("time utils", () => {
  it("computes elapsed from timestamps, clamps backward clock", () => {
    expect(elapsedMs(1000, 6000)).toBe(5000);
    expect(elapsedMs(6000, 1000)).toBe(0);
  });
  it("rejects end before start", () => {
    expect(() => finalizeDurationMs(5000, 1000)).toThrow();
    expect(finalizeDurationMs(1000, 5000)).toBe(4000);
  });
  it("formats HH:MM:SS with unbounded hours", () => {
    expect(formatHMS(0)).toBe("00:00:00");
    expect(formatHMS(5020000)).toBe("01:23:40");
    expect(formatHMS(25 * 3600000)).toBe("25:00:00");
  });
  it("proves timestamp-diff not tick-count (5s gap, 5 ticks skipped)", () => {
    const t0 = 1_000_000;
    expect(formatHMS(elapsedMs(t0, t0 + 5020))).toBe("00:00:05");
  });
});

describe("tab persistence", () => {
  it("validates saved tab and falls back to day", () => {
    expect(parseActiveTab("settings")).toBe("settings");
    expect(parseActiveTab("evil")).toBe("day");
    expect(parseActiveTab(null)).toBe("day");
  });
});
