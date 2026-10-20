import { beforeEach, describe, expect, it } from "vitest";
import { __resetDbForTests } from "../db/client";
import { __clearMemoryDb } from "../db/memory";
import * as dayRepo from "../repositories/businessDayRepo";
import * as stationRepo from "../repositories/stationRepo";
import * as sessionRepo from "../repositories/sessionRepo";
import { sessionRevenueMinor } from "../domain/pricing";

beforeEach(() => {
  __clearMemoryDb();
  __resetDbForTests();
});

async function firstStationId(): Promise<number> {
  const all = await stationRepo.listStations();
  return all[0]!.id;
}

async function setRate(id: number, minor: number): Promise<void> {
  const cur = (await stationRepo.getStation(id))!;
  await stationRepo.updateStation(id, {
    name: cur.name,
    colorHex: cur.colorHex,
    isVisible: true,
    isActive: true,
    hourlyRateMinor: minor,
  });
}

describe("per-device hourly pricing persistence", () => {
  it("defaults seeded stations to unpriced (0) without changing names", async () => {
    const all = await stationRepo.listStations();
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) expect(s.hourlyRateMinor).toBe(0);
  });
  it("saves and reloads a per-device rate via update", async () => {
    const id = await firstStationId();
    await setRate(id, 2500);
    expect((await stationRepo.getStation(id))?.hourlyRateMinor).toBe(2500);
  });
  it("saves a rate on create", async () => {
    const s = await stationRepo.createStation("Priced Device", "#ffffff", 3000);
    expect((await stationRepo.getStation(s.id))?.hourlyRateMinor).toBe(3000);
  });
  it("rejects negative rates at the repo boundary", async () => {
    const id = await firstStationId();
    const cur = (await stationRepo.getStation(id))!;
    await expect(
      stationRepo.updateStation(id, {
        name: cur.name,
        colorHex: cur.colorHex,
        isVisible: true,
        isActive: true,
        hourlyRateMinor: -100,
      }),
    ).rejects.toThrow();
  });
  it("changing one device price does not affect another device", async () => {
    const all = await stationRepo.listStations();
    const [a, b] = [all[0]!, all[1]!];
    await setRate(a.id, 2500);
    expect((await stationRepo.getStation(b.id))?.hourlyRateMinor).toBe(0);
  });

  describe("historical pricing integrity", () => {
    it("snapshots the rate at start; later edits don't touch history", async () => {
      const t0 = 1_700_000_000_000;
      const day = await dayRepo.openDay(t0);
      const id = await firstStationId();
      await setRate(id, 2000);
      const s = await sessionRepo.startSession(id, day.id, t0);
      expect(s.rateMinorAtStart).toBe(2000);
      const done = await sessionRepo.stopSession(s.id, t0 + 3_600_000);
      expect(done.rateMinorAtStart).toBe(2000);
      await setRate(id, 9000);
      const page = await sessionRepo.listSessionsForStation(id, 20, 0);
      expect(page.rows[0]!.rateMinorAtStart).toBe(2000);
      expect((await sessionRepo.aggregateForStation(id)).revenueMinor).toBe(
        2000,
      );
    });
    it("running session keeps its snapshot on mid-session rate change", async () => {
      const t0 = 1_700_000_000_000;
      const day = await dayRepo.openDay(t0);
      const id = await firstStationId();
      await setRate(id, 2000);
      await sessionRepo.startSession(id, day.id, t0);
      await setRate(id, 8000);
      expect((await sessionRepo.getActiveSession(id))?.rateMinorAtStart).toBe(
        2000,
      );
    });
    it("legacy NULL snapshots count time but not revenue", async () => {
      const t0 = 1_700_000_000_000;
      const day = await dayRepo.openDay(t0);
      const id = await firstStationId();
      const { getActiveDb } = await import("../db/client");
      const db = await getActiveDb();
      await db.execute(
        "INSERT INTO rental_sessions(station_id, business_day_id, started_at_utc, ended_at_utc, duration_ms) VALUES (?, ?, ?, NULL, NULL)",
        [id, day.id, t0],
      );
      const active = await sessionRepo.getActiveSession(id);
      await sessionRepo.stopSession(active!.id, t0 + 3_600_000);
      const agg = await sessionRepo.aggregateForStation(id);
      expect(agg.count).toBe(1);
      expect(agg.totalMs).toBe(3_600_000);
      expect(agg.revenueMinor).toBe(0);
      expect(agg.pricedCount).toBe(0);
      expect(sessionRevenueMinor(3_600_000, null)).toBeNull();
    });
    it("counts and totals are scoped by stable id", async () => {
      const t0 = 1_700_000_000_000;
      const day = await dayRepo.openDay(t0);
      const all = await stationRepo.listStations();
      const [a, b] = [all[0]!.id, all[1]!.id];
      await setRate(a, 3600);
      await setRate(b, 3600);
      const s1 = await sessionRepo.startSession(a, day.id, t0);
      await sessionRepo.stopSession(s1.id, t0 + 3_600_000);
      const s2 = await sessionRepo.startSession(a, day.id, t0 + 4_000_000);
      await sessionRepo.stopSession(s2.id, t0 + 4_000_000 + 1_800_000);
      const s3 = await sessionRepo.startSession(b, day.id, t0);
      await sessionRepo.stopSession(s3.id, t0 + 600_000);
      const aggA = await sessionRepo.aggregateForStation(a);
      const aggB = await sessionRepo.aggregateForStation(b);
      expect(aggA.count).toBe(2);
      expect(aggA.totalMs).toBe(5_400_000);
      expect(aggB.count).toBe(1);
      expect(aggB.totalMs).toBe(600_000);
      expect(aggA.revenueMinor).toBe(5400);
      expect(aggB.revenueMinor).toBe(600);
    });
    it("history is newest-first with pagination", async () => {
      const t0 = 1_700_000_000_000;
      const day = await dayRepo.openDay(t0);
      const id = await firstStationId();
      for (let i = 0; i < 3; i++) {
        const s = await sessionRepo.startSession(id, day.id, t0 + i * 1000);
        await sessionRepo.stopSession(s.id, t0 + i * 1000 + 60_000);
      }
      await sessionRepo.startSession(id, day.id, t0 + 9999);
      const p1 = await sessionRepo.listSessionsForStation(id, 2, 0);
      expect(p1.total).toBe(4);
      expect(p1.rows).toHaveLength(2);
      expect(p1.rows[0]!.endedAtUtc).toBeNull();
      const p2 = await sessionRepo.listSessionsForStation(id, 2, 2);
      expect(p2.rows).toHaveLength(2);
      const starts = [...p1.rows, ...p2.rows].map((r) => r.startedAtUtc);
      expect([...starts].sort((x, y) => y - x)).toEqual(starts);
    });
    it("zero-duration sessions bill zero", async () => {
      const t0 = 1_700_000_000_000;
      const day = await dayRepo.openDay(t0);
      const id = await firstStationId();
      await setRate(id, 2500);
      const s = await sessionRepo.startSession(id, day.id, t0);
      const done = await sessionRepo.stopSession(s.id, t0);
      expect(done.durationMs).toBe(0);
      expect(sessionRevenueMinor(done.durationMs, done.rateMinorAtStart)).toBe(
        0,
      );
    });
  });
});
