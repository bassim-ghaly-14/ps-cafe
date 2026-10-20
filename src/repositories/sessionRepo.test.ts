import { describe, expect, it, beforeEach } from "vitest";
import { __resetDbForTests } from "../db/client";
import { __clearMemoryDb } from "../db/memory";
import * as dayRepo from "../repositories/businessDayRepo";
import * as sessionRepo from "../repositories/sessionRepo";
import * as stationRepo from "../repositories/stationRepo";
import { sessionRevenueMinor } from "../domain/pricing";
import { formatWeekdayDateTime, formatWorkdayStamp } from "../utils/format";

beforeEach(() => {
  __clearMemoryDb();
  __resetDbForTests();
});

async function pricedStationId(minor: number): Promise<number> {
  const all = await stationRepo.listStations();
  const id = all[0]!.id;
  const cur = await stationRepo.getStation(id);
  await stationRepo.updateStation(id, {
    name: cur!.name,
    colorHex: cur!.colorHex,
    isVisible: true,
    isActive: true,
    hourlyRateMinor: minor,
  });
  return id;
}

describe("workday history aggregation integrity", () => {
  it("each closed day receives only its own sessions via listDayAggregates", async () => {
    const t0 = Date.UTC(2026, 9, 17, 8, 0, 0);
    const day1 = await dayRepo.openDay(t0);
    const sid1 = await pricedStationId(2000);
    const s1 = await sessionRepo.startSession(sid1, day1.id, t0 + 1000);
    await sessionRepo.stopSession(s1.id, t0 + 1000 + 3_600_000);
    await dayRepo.closeDay(day1.id, t0 + 3_700_000);

    const day2 = await dayRepo.openDay(t0 + 100_000_000);
    const sid2 = await pricedStationId(4000);
    const s2 = await sessionRepo.startSession(sid2, day2.id, t0 + 100_001_000);
    await sessionRepo.stopSession(s2.id, t0 + 100_001_000 + 7_200_000);
    await dayRepo.closeDay(day2.id, t0 + 100_008_300_000);

    const aggs = await sessionRepo.listDayAggregates();
    const byDay = new Map(aggs.map((a) => [a.dayId, a]));

    const d1 = byDay.get(day1.id)!;
    expect(d1.count).toBe(1);
    expect(d1.totalMs).toBe(3_600_000);
    expect(d1.revenueMinor).toBe(2000);

    const d2 = byDay.get(day2.id)!;
    expect(d2.count).toBe(1);
    expect(d2.totalMs).toBe(7_200_000);
    expect(d2.revenueMinor).toBe(8000);
  });

  it("does not leak one day's revenue into another day", async () => {
    const t0 = Date.UTC(2026, 9, 17, 8, 0, 0);
    const day1 = await dayRepo.openDay(t0);
    const sid = await pricedStationId(2000);
    const s = await sessionRepo.startSession(sid, day1.id, t0 + 1000);
    await sessionRepo.stopSession(s.id, t0 + 1000 + 3_600_000);
    await dayRepo.closeDay(day1.id, t0 + 3_700_000);

    const day2 = await dayRepo.openDay(t0 + 200_000_000);
    await dayRepo.closeDay(day2.id, t0 + 200_001_000_000);

    const aggs = await sessionRepo.listDayAggregates();
    const byDay = new Map(aggs.map((a) => [a.dayId, a]));
    // day2 had no sessions, so it contributes no aggregate row.
    expect(byDay.has(day2.id)).toBe(false);
    expect(byDay.get(day1.id)!.revenueMinor).toBe(2000);
  });

  it("excludes running sessions from day aggregates", async () => {
    const t0 = Date.UTC(2026, 9, 17, 8, 0, 0);
    const day = await dayRepo.openDay(t0);
    const sid = await pricedStationId(2000);
    await sessionRepo.startSession(sid, day.id, t0 + 1000); // still running

    const agg = await sessionRepo.aggregateForDay(day.id);
    expect(agg.count).toBe(0);
    expect(agg.totalMs).toBe(0);
    expect(agg.revenueMinor).toBe(0);
  });

  it("revenue uses each session's own rate snapshot, not the current rate", async () => {
    const t0 = Date.UTC(2026, 9, 17, 8, 0, 0);
    const day = await dayRepo.openDay(t0);
    const sid = await pricedStationId(2000);
    const session = await sessionRepo.startSession(sid, day.id, t0 + 1000);
    await sessionRepo.stopSession(session.id, t0 + 3_601_000);
    await dayRepo.closeDay(day.id, t0 + 3_700_000);

    // Raise the device rate after the session is history.
    const cur = await stationRepo.getStation(sid);
    await stationRepo.updateStation(sid, {
      name: cur!.name,
      colorHex: cur!.colorHex,
      isVisible: true,
      isActive: true,
      hourlyRateMinor: 999900,
    });

    const agg = await sessionRepo.aggregateForDay(day.id);
    expect(agg.revenueMinor).toBe(2000); // 1h @ 20 EGP, not 9999 EGP
  });

  it("an empty day yields a zero aggregate", async () => {
    const t0 = Date.UTC(2026, 9, 17, 8, 0, 0);
    const day = await dayRepo.openDay(t0);
    await dayRepo.closeDay(day.id, t0 + 3600000);

    const agg = await sessionRepo.aggregateForDay(day.id);
    expect(agg.count).toBe(0);
    expect(agg.totalMs).toBe(0);
    expect(agg.revenueMinor).toBe(0);
  });

  it("sessionRevenueMinor returns null for legacy unpriced sessions", () => {
    expect(sessionRevenueMinor(3_600_000, null)).toBeNull();
    expect(sessionRevenueMinor(null, 2000)).toBeNull();
    expect(sessionRevenueMinor(3_600_000, 2000)).toBe(2000);
  });
});

describe("workday timestamp formatting", () => {
  it("weekday and datetime are derived from the same persisted instant", () => {
    const t = Date.UTC(2026, 9, 17, 8, 30, 0);
    const date = new Date(t);
    const weekday = new Intl.DateTimeFormat("ar", { weekday: "long" }).format(
      date,
    );
    const stamp = formatWorkdayStamp(t);
    expect(stamp.weekday).toBe(weekday);
    expect(stamp.date).toContain("2026");
    expect(stamp.time).toMatch(/\d{1,2}:\d{2}/);
  });

  it("emits no bidi control characters", () => {
    const stamp = formatWorkdayStamp(Date.UTC(2026, 9, 17, 8, 30, 0));
    for (const value of Object.values(stamp)) {
      expect(value).not.toMatch(
        /[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/,
      );
    }
  });

  it("splits date and time so the UI can isolate them", () => {
    const stamp = formatWorkdayStamp(Date.UTC(2026, 9, 17, 8, 30, 0));
    expect(stamp.date).not.toContain(":");
    expect(stamp.time).not.toContain("/");
    expect(stamp.date).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
  });

  it("uses an Arabic comma separator for Arabic and a Latin one otherwise", () => {
    const t = Date.UTC(2026, 9, 17, 8, 30, 0);
    expect(formatWorkdayStamp(t, "ar").timeSeparator).toBe("، ");
    expect(formatWorkdayStamp(t, "en").timeSeparator).toBe(", ");
  });

  it("is deterministic for the same timestamp", () => {
    const t = Date.UTC(2026, 9, 17, 8, 30, 0);
    expect(formatWorkdayStamp(t)).toEqual(formatWorkdayStamp(t));
    expect(formatWeekdayDateTime(t)).toBe(formatWeekdayDateTime(t));
  });

  it("invalid timestamp does not throw and falls back", () => {
    expect(() => formatWeekdayDateTime(NaN as unknown as number)).not.toThrow();
    expect(formatWeekdayDateTime(NaN as unknown as number)).toContain(
      "Invalid Date",
    );
    expect(() => formatWeekdayDateTime(-1 as unknown as number)).not.toThrow();
  });
});
