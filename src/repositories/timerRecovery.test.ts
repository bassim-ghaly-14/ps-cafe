import { beforeEach, describe, expect, it } from "vitest";
import { __resetDbForTests, getActiveDb, getDb } from "../db/client";
import { __clearMemoryDb } from "../db/memory";
import { elapsedMs, isValidTimestamp, clockJumpInfo } from "../utils/time";
import * as dayRepo from "../repositories/businessDayRepo";
import * as sessionRepo from "../repositories/sessionRepo";

beforeEach(() => {
  __clearMemoryDb();
  __resetDbForTests();
});

async function prodStationId(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ id: number }>(
    "SELECT id FROM stations WHERE is_active = 1 ORDER BY id LIMIT 1",
  );
  return rows[0]!.id;
}

describe("timer recovery: business day survives reload", () => {
  it("elapsed reflects a later timestamp after simulated downtime", async () => {
    const t0 = 1_700_000_000_000;
    const day = await dayRepo.openDay(t0);
    // Simulate app restart: drop the client singleton; localStorage-backed
    // state survives, so recovery must re-read the same persisted row.
    __resetDbForTests();
    const reopened = await dayRepo.getOpenDay();
    expect(reopened?.id).toBe(day.id);
    // 1h of downtime: 18:15 close -> 19:15 reopen must show ~01:15:00.
    const t1 = t0 + 75 * 60_1000;
    expect(elapsedMs(reopened!.startedAtUtc, t1)).toBe(75 * 60_1000);
  });

  it("open day survives across midnight (no date logic)", async () => {
    // 2024-01-01T22:00:00Z -> +5h20 spans midnight, still one open day.
    const start = Date.UTC(2024, 0, 1, 22, 0, 0);
    const day = await dayRepo.openDay(start);
    const later = start + 5 * 3_600_000 + 20 * 60_1000;
    const open = await dayRepo.getOpenDay();
    expect(open?.id).toBe(day.id);
    expect(elapsedMs(open!.startedAtUtc, later)).toBe(
      5 * 3_600_000 + 20 * 60_1000,
    );
  });

  it("closed days stay closed and completed sessions stay completed", async () => {
    const t0 = 1_700_000_000_000;
    const day = await dayRepo.openDay(t0);
    const sid = await prodStationId();
    const s = await sessionRepo.startSession(sid, day.id, t0 + 1000);
    await sessionRepo.stopSession(s.id, t0 + 3700_000);
    await dayRepo.closeDay(day.id, t0 + 7200_000);
    expect(await dayRepo.getOpenDay()).toBeNull();
    expect(await sessionRepo.listActiveSessions()).toEqual([]);
    const agg = await sessionRepo.aggregateForDay(day.id);
    expect(agg.count).toBe(1);
    expect(await dayRepo.countClosedDays()).toBe(1);
  });

  it("repeated initialization does not reset or duplicate records", async () => {
    const t0 = 1_700_000_000_000;
    const day = await dayRepo.openDay(t0);
    await getDb();
    await getDb();
    await getDb();
    const open = await dayRepo.getOpenDay();
    expect(open?.id).toBe(day.id);
    const days = await dayRepo.listDays(50);
    expect(days.filter((d) => d.endedAtUtc === null)).toHaveLength(1);
  });

  it("invalid persisted timestamps are handled safely (never negative)", async () => {
    expect(elapsedMs(Number.NaN, Date.now())).toBe(0);
    expect(elapsedMs(-5, Date.now())).toBe(0);
    expect(elapsedMs(0, Date.now())).toBe(0);
    expect(isValidTimestamp(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidTimestamp("123" as unknown as number)).toBe(false);
    // Backward clock jump clamps instead of going negative.
    expect(elapsedMs(2000, 1000)).toBe(0);
    expect(clockJumpInfo(2000, 1000)).toBe("clamped-backward");
    expect(clockJumpInfo(Number.NaN, 1000)).toBe("invalid");
    expect(clockJumpInfo(1000, 2000)).toBe("ok");
  });
});

describe("timer recovery: station sessions survive reload", () => {
  it("active session elapsed reflects downtime after reload", async () => {
    const t0 = 1_700_000_000_000;
    const day = await dayRepo.openDay(t0);
    const sid = await prodStationId();
    const s = await sessionRepo.startSession(sid, day.id, t0);
    const active = await sessionRepo.listActiveSessions();
    expect(active.map((a) => a.id)).toContain(s.id);
    // Simulate 1h power loss: timer must show ~01:00:00, not 00:00:00.
    const t1 = t0 + 3_600_000;
    const again = await sessionRepo.getActiveSession(sid);
    expect(again?.id).toBe(s.id);
    expect(elapsedMs(again!.startedAtUtc, t1)).toBe(3_600_000);
  });

  it("multiple active stations recover independently", async () => {
    const t0 = 1_700_000_000_000;
    const day = await dayRepo.openDay(t0);
    const db = await getActiveDb();
    const stations = await db.select<{ id: number }>(
      "SELECT id FROM stations WHERE is_active = 1 ORDER BY id LIMIT 3",
    );
    const ids = stations.map((r) => r.id);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    await sessionRepo.startSession(ids[0]!, day.id, t0);
    await sessionRepo.startSession(ids[1]!, day.id, t0 + 10 * 60_1000);
    await sessionRepo.startSession(ids[2]!, day.id, t0 + 20 * 60_1000);
    const t1 = t0 + 60 * 60_1000;
    const active = await sessionRepo.listActiveSessions();
    expect(active).toHaveLength(3);
    const byStation = new Map(active.map((a) => [a.stationId, a.startedAtUtc]));
    expect(elapsedMs(byStation.get(ids[0]!)!, t1)).toBe(60 * 60_1000);
    expect(elapsedMs(byStation.get(ids[1]!)!, t1)).toBe(50 * 60_1000);
    expect(elapsedMs(byStation.get(ids[2]!)!, t1)).toBe(40 * 60_1000);
  });

  it("startup recovery creates no duplicate sessions", async () => {
    const t0 = 1_700_000_000_000;
    const day = await dayRepo.openDay(t0);
    const sid = await prodStationId();
    await sessionRepo.startSession(sid, day.id, t0);
    await getDb();
    await getDb();
    const active = await sessionRepo.listActiveSessions();
    expect(active.filter((a) => a.stationId === sid)).toHaveLength(1);
  });
});
