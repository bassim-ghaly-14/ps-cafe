import { describe, expect, it } from "vitest";
import { canCloseDay, canOpenDay } from "../domain/businessDay";
import {
  canStartSessionDetailed,
  canStopSession,
  validateColorHex,
  validateStationName,
} from "../domain/rentalSession";

describe("business-day guards (extended)", () => {
  it("blocks opening when one is already open", () => {
    expect(canOpenDay(true).ok).toBe(false);
    expect(canOpenDay(false).ok).toBe(true);
  });
  it("blocks closing while sessions are active", () => {
    expect(canCloseDay(2).ok).toBe(false);
    expect(canCloseDay(0).ok).toBe(true);
  });
});

describe("rental-session guards", () => {
  const gate = (
    dayOpen = true,
    stationEligible = true,
    stationBusy = false,
  ) => ({
    dayOpen,
    stationEligible,
    stationBusy,
  });

  it("rejects start when no business day open", () => {
    expect(canStartSessionDetailed(gate(false)).code).toBe("DAY_CLOSED");
  });
  it("rejects start when station inactive", () => {
    expect(canStartSessionDetailed(gate(true, false)).code).toBe(
      "STATION_INACTIVE",
    );
  });
  it("rejects start when station busy", () => {
    expect(canStartSessionDetailed(gate(true, true, true)).code).toBe(
      "STATION_BUSY",
    );
  });
  it("allows start when day open, station eligible and idle", () => {
    expect(canStartSessionDetailed(gate()).code).toBe("OK");
  });
  it("rejects stop when no active session", () => {
    expect(canStopSession(false).code).toBe("NO_ACTIVE_SESSION");
  });
  it("allows stop when active session exists", () => {
    expect(canStopSession(true).code).toBe("OK");
  });
});

describe("station name validation", () => {
  it("accepts valid names", () => {
    expect(validateStationName("PS5 — جهاز 1").ok).toBe(true);
    expect(validateStationName("  PS5   جهاز  ").value).toBe("PS5 جهاز");
  });
  it("rejects empty name", () => {
    expect(validateStationName("").ok).toBe(false);
    expect(validateStationName("   ").ok).toBe(false);
  });
  it("rejects names longer than 60 chars", () => {
    expect(validateStationName("x".repeat(61)).ok).toBe(false);
    expect(validateStationName("x".repeat(60)).ok).toBe(true);
  });
});

describe("color hex validation", () => {
  it("accepts valid hex", () => {
    expect(validateColorHex("#2ee6ff")).toBe(true);
    expect(validateColorHex("#000000")).toBe(true);
    expect(validateColorHex("#FFFFFF")).toBe(true);
  });
  it("rejects invalid hex", () => {
    expect(validateColorHex("2ee6ff")).toBe(false);
    expect(validateColorHex("#ggg")).toBe(false);
    expect(validateColorHex("#12345")).toBe(false);
  });
});
