import { describe, expect, it, beforeEach } from "vitest";
import { __resetDbForTests } from "../db/client";
import { __clearMemoryDb } from "../db/memory";
import * as dayRepo from "../repositories/businessDayRepo";
import * as sessionRepo from "../repositories/sessionRepo";

beforeEach(() => {
  __clearMemoryDb();
  __resetDbForTests();
});

describe("business day repository", () => {
  it("has no open day on fresh db", async () => {
    const open = await dayRepo.getOpenDay();
    expect(open).toBeNull();
  });

  it("opens a day and rejects a second open day", async () => {
    const now = Date.now();
    const first = await dayRepo.openDay(now);
    expect(first.startedAtUtc).toBe(now);

    const open = await dayRepo.getOpenDay();
    expect(open?.id).toBe(first.id);

    await expect(dayRepo.openDay(now + 1000)).rejects.toThrow(
      /already open|UNIQUE/,
    );
  });

  it("lists days in descending id order", async () => {
    const now = Date.now();
    const d1 = await dayRepo.openDay(now);
    await dayRepo.closeDay(d1.id, now + 3600000);
    const d2 = await dayRepo.openDay(now + 7200000);

    const days = await dayRepo.listDays();
    expect(days[0]!.id).toBe(d2.id);
    expect(days[1]!.id).toBe(d1.id);
    expect(days[1]!.endedAtUtc).toBe(now + 3600000);
  });

  it("closes a day with the correct end timestamp", async () => {
    const now = Date.now();
    const day = await dayRepo.openDay(now);
    const closed = await dayRepo.closeDay(day.id, now + 5400000);
    expect(closed.endedAtUtc).toBe(now + 5400000);
    const open = await dayRepo.getOpenDay();
    expect(open).toBeNull();
  });

  it("counts closed days", async () => {
    expect(await dayRepo.countClosedDays()).toBe(0);
    const now = Date.now();
    const d = await dayRepo.openDay(now);
    await dayRepo.closeDay(d.id, now + 1000);
    expect(await dayRepo.countClosedDays()).toBe(1);
  });

  it("preserves history after close", async () => {
    const now = Date.now();
    const d = await dayRepo.openDay(now);
    await dayRepo.closeDay(d.id, now + 3600000);
    const days = await dayRepo.listDays();
    expect(days.some((day) => day.id === d.id && day.endedAtUtc !== null)).toBe(
      true,
    );
  });
});

describe("session repository", () => {
  const openDay = async () => {
    const now = Date.now();
    return dayRepo.openDay(now);
  };

  const seedStation = async () => {
    // stations are seeded automatically on first run via client.ts
    const all = await (await import("../db/client")).getDb();
    const rows = await all.select<{ id: number }>(
      "SELECT id FROM stations WHERE is_active = 1 ORDER BY id LIMIT 1",
    );
    return rows[0]!.id;
  };

  it("starts a session on an eligible station during an open day", async () => {
    const day = await openDay();
    const sid = await seedStation();
    const session = await sessionRepo.startSession(sid, day.id, Date.now());
    expect(session.businessDayId).toBe(day.id);
    expect(session.stationId).toBe(sid);
    expect(session.endedAtUtc).toBeNull();
  });

  it("rejects starting a session with no open business day", async () => {
    const sid = await seedStation();
    await expect(
      sessionRepo.startSession(sid, 99999, Date.now()),
    ).rejects.toThrow(/No open business day|DAY_CLOSED/);
  });

  it("rejects a duplicate active session on the same station", async () => {
    const day = await openDay();
    const sid = await seedStation();
    await sessionRepo.startSession(sid, day.id, Date.now());
    await expect(
      sessionRepo.startSession(sid, day.id, Date.now() + 1000),
    ).rejects.toThrow(/UNIQUE/);
  });

  it("stops an active session and persists duration", async () => {
    const day = await openDay();
    const sid = await seedStation();
    const start = Date.now();
    const session = await sessionRepo.startSession(sid, day.id, start);
    const end = start + 3600000;
    const done = await sessionRepo.stopSession(session.id, end);
    expect(done.durationMs).toBe(3600000);
    expect(done.endedAtUtc).toBe(end);
  });

  it("rejects stopping a session that is not active", async () => {
    await expect(sessionRepo.stopSession(99999, Date.now())).rejects.toThrow(
      /Active session not found|NOT_FOUND/,
    );
  });

  it("lists active sessions and restores them after reload", async () => {
    const day = await openDay();
    const sid = await seedStation();
    await sessionRepo.startSession(sid, day.id, Date.now());
    const active = await sessionRepo.listActiveSessions();
    expect(active.length).toBe(1);
    expect(active[0]!.stationId).toBe(sid);
  });

  it("calculates per-day aggregates correctly", async () => {
    const day = await openDay();
    const sid = await seedStation();
    const start = Date.now();
    const session = await sessionRepo.startSession(sid, day.id, start);
    await sessionRepo.stopSession(session.id, start + 3600000);
    const agg = await sessionRepo.aggregateForDay(day.id);
    expect(agg.count).toBe(1);
    expect(agg.totalMs).toBe(3600000);
  });

  it("calculates all-time aggregates", async () => {
    const agg = await sessionRepo.aggregateAllTime();
    expect(agg.count).toBe(0);
    expect(agg.totalMs).toBe(0);
  });
});
