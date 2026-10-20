import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryPort, __clearMemoryDb } from "../db/memory";
import { __resetDbForTests as resetClient } from "../db/client";

function resetDb(): void {
  __clearMemoryDb();
  resetClient();
}

describe("memory db port persistence", () => {
  beforeEach(resetDb);

  it("creates default stations on first run", async () => {
    const db = createMemoryPort();
    const rows = await db.select<{ id: number; name: string }>(
      "SELECT id, name FROM stations ORDER BY sort_order ASC",
    );
    expect(rows.map((r) => r.name)).toEqual([
      "PS5 — جهاز 1",
      "PS5 — جهاز 2",
      "PS4 — جهاز 3",
      "PS4 — جهاز 4",
    ]);
  });

  it("opens and closes a business day", async () => {
    const db = createMemoryPort();
    const now = Date.now();
    await db.execute(
      "INSERT INTO business_days(started_at_utc, created_at_utc) VALUES (?, ?)",
      [now, now],
    );
    const open = await db.select<{ id: number; ended_at_utc: number | null }>(
      "SELECT id, ended_at_utc FROM business_days WHERE ended_at_utc IS NULL LIMIT 1",
    );
    expect(open.length).toBe(1);

    await db.execute(
      "UPDATE business_days SET ended_at_utc = ? WHERE id = ? AND ended_at_utc IS NULL",
      [now + 10000, open[0]!.id],
    );
    const closed = await db.select<{ id: number; ended_at_utc: number | null }>(
      "SELECT id, ended_at_utc FROM business_days WHERE id = ?",
      [open[0]!.id],
    );
    expect(closed[0]!.ended_at_utc).toBe(now + 10000);
  });

  it("rejects opening a second business day while one is open", async () => {
    const db = createMemoryPort();
    const now = Date.now();
    await db.execute(
      "INSERT INTO business_days(started_at_utc, created_at_utc) VALUES (?, ?)",
      [now, now],
    );
    await expect(
      db.execute(
        "INSERT INTO business_days(started_at_utc, created_at_utc) VALUES (?, ?)",
        [now + 1000, now + 1000],
      ),
    ).rejects.toThrow();
  });

  it("rejects closing a business day with active sessions", async () => {
    const db = createMemoryPort();
    const now = Date.now();
    // seed a station first
    await db.execute(
      "INSERT INTO stations(name, color_hex, sort_order, is_visible, is_active, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["PS5 — جهاز 1", "#2ee6ff", 0, 1, 1, now, now],
    );
    const stationRows = await db.select<{ id: number }>(
      "SELECT id FROM stations LIMIT 1",
    );
    await db.execute(
      "INSERT INTO business_days(started_at_utc, created_at_utc) VALUES (?, ?)",
      [now, now],
    );
    const dayRows = await db.select<{ id: number }>(
      "SELECT id FROM business_days WHERE ended_at_utc IS NULL LIMIT 1",
    );
    const sid = stationRows[0]!.id;
    const dayId = dayRows[0]!.id;
    await db.execute(
      "INSERT INTO rental_sessions(station_id, business_day_id, started_at_utc, ended_at_utc, duration_ms) VALUES (?, ?, ?, NULL, NULL)",
      [sid, dayId, now],
    );
    await expect(
      db.execute(
        "UPDATE business_days SET ended_at_utc = ? WHERE id = ? AND ended_at_utc IS NULL",
        [now + 10000, dayId],
      ),
    ).rejects.toThrow();
  });

  it("starts and stops a session atomically", async () => {
    const db = createMemoryPort();
    const now = Date.now();
    await db.execute(
      "INSERT INTO stations(name, color_hex, sort_order, is_visible, is_active, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["PS5 — جهاز 1", "#2ee6ff", 0, 1, 1, now, now],
    );
    const stationRows = await db.select<{ id: number }>(
      "SELECT id FROM stations LIMIT 1",
    );
    const sid = stationRows[0]!.id;

    // open day
    await db.execute(
      "INSERT INTO business_days(started_at_utc, created_at_utc) VALUES (?, ?)",
      [now, now],
    );
    const dayRows = await db.select<{ id: number }>(
      "SELECT id FROM business_days WHERE ended_at_utc IS NULL LIMIT 1",
    );
    const did = dayRows[0]!.id;

    await db.execute(
      "INSERT INTO rental_sessions(station_id, business_day_id, started_at_utc, ended_at_utc, duration_ms) VALUES (?, ?, ?, NULL, NULL)",
      [sid, did, now],
    );
    const active = await db.select<{ id: number; ended_at_utc: number | null }>(
      "SELECT id, ended_at_utc FROM rental_sessions WHERE station_id = ? AND ended_at_utc IS NULL",
      [sid],
    );
    expect(active.length).toBe(1);

    // second start on same station should violate partial unique index
    await expect(
      db.execute(
        "INSERT INTO rental_sessions(station_id, business_day_id, started_at_utc, ended_at_utc, duration_ms) VALUES (?, ?, ?, NULL, NULL)",
        [sid, did, now + 1000],
      ),
    ).rejects.toThrow(/UNIQUE/);

    const end = now + 3600000;
    await db.execute(
      "UPDATE rental_sessions SET ended_at_utc = ?, duration_ms = ? WHERE id = ?",
      [end, end - now, active[0]!.id],
    );
    const done = await db.select<{ id: number; duration_ms: number }>(
      "SELECT id, duration_ms FROM rental_sessions WHERE id = ?",
      [active[0]!.id],
    );
    expect(done[0]!.duration_ms).toBe(3600000);
  });

  it("rejects stop with negative duration", async () => {
    const db = createMemoryPort();
    const now = Date.now();
    await expect(
      db.execute(
        "UPDATE rental_sessions SET ended_at_utc = ?, duration_ms = ? WHERE id = ?",
        [now - 1000, -1000, 999],
      ),
    ).rejects.toThrow();
  });
});

describe("memory db aggregated queries", () => {
  beforeEach(resetDb);

  async function seedSessions(
    db: ReturnType<typeof createMemoryPort>,
  ): Promise<void> {
    const now = Date.now();

    // Same SQL shapes the repositories use — the memory port interprets
    // parameters positionally, so the param order must match exactly.
    await db.execute(
      "INSERT INTO stations(name, color_hex, sort_order, is_visible, is_active, hourly_rate_minor, created_at_utc, updated_at_utc) VALUES (?, ?, ?, 1, 1, ?, ?, ?)",
      ["PS5 — جهاز 1", "#2ee6ff", 0, 2000, now, now],
    );
    const stationRows = await db.select<{ id: number }>(
      "SELECT id FROM stations ORDER BY id ASC",
    );
    const sid = stationRows[0]!.id;

    // Day 1 with one completed session (1h @ 20 EGP/h = 20 EGP).
    await db.execute(
      "INSERT INTO business_days(started_at_utc, created_at_utc) VALUES (?, ?)",
      [now, now],
    );
    const day1 = await db.select<{ id: number }>(
      "SELECT id FROM business_days WHERE ended_at_utc IS NULL LIMIT 1",
    );
    await db.execute(
      "INSERT INTO rental_sessions(station_id, business_day_id, started_at_utc, ended_at_utc, duration_ms, rate_minor_at_start) VALUES (?, ?, ?, NULL, NULL, ?)",
      [sid, day1[0]!.id, now, 2000],
    );
    const session1 = await db.select<{ id: number }>(
      "SELECT id FROM rental_sessions WHERE business_day_id = ? AND ended_at_utc IS NULL LIMIT 1",
      [day1[0]!.id],
    );
    await db.execute(
      "UPDATE rental_sessions SET ended_at_utc = ?, duration_ms = ? WHERE id = ?",
      [now + 3_600_000, 3_600_000, session1[0]!.id],
    );
    await db.execute(
      "UPDATE business_days SET ended_at_utc = ? WHERE id = ? AND ended_at_utc IS NULL",
      [now + 3_700_000, day1[0]!.id],
    );

    // Day 2 with a completed session on a different station (2h @ 40 EGP/h).
    await db.execute(
      "INSERT INTO stations(name, color_hex, sort_order, is_visible, is_active, hourly_rate_minor, created_at_utc, updated_at_utc) VALUES (?, ?, ?, 1, 1, ?, ?, ?)",
      ["PS5 — جهاز 2", "#b36bff", 1, 4000, now, now],
    );
    const stations = await db.select<{ id: number }>(
      "SELECT id FROM stations ORDER BY id ASC",
    );
    await db.execute(
      "INSERT INTO business_days(started_at_utc, created_at_utc) VALUES (?, ?)",
      [now + 100_000_000, now + 100_000_000],
    );
    const day2 = await db.select<{ id: number }>(
      "SELECT id FROM business_days WHERE ended_at_utc IS NULL LIMIT 1",
    );
    await db.execute(
      "INSERT INTO rental_sessions(station_id, business_day_id, started_at_utc, ended_at_utc, duration_ms, rate_minor_at_start) VALUES (?, ?, ?, NULL, NULL, ?)",
      [stations[1]!.id, day2[0]!.id, now + 100_000_000, 4000],
    );
    const session2 = await db.select<{ id: number }>(
      "SELECT id FROM rental_sessions WHERE business_day_id = ? AND ended_at_utc IS NULL LIMIT 1",
      [day2[0]!.id],
    );
    await db.execute(
      "UPDATE rental_sessions SET ended_at_utc = ?, duration_ms = ? WHERE id = ?",
      [now + 107_200_000, 7_200_000, session2[0]!.id],
    );
    await db.execute(
      "UPDATE business_days SET ended_at_utc = ? WHERE id = ? AND ended_at_utc IS NULL",
      [now + 107_300_000, day2[0]!.id],
    );
  }

  it("returns one row per business day for the per-day GROUP BY query", async () => {
    const db = createMemoryPort();
    await seedSessions(db);

    const rows = await db.select<{
      dayId: number;
      count: number;
      totalMs: number;
      revenueMinor: number;
    }>(
      "SELECT business_day_id AS dayId, COUNT(*) AS count, SUM(duration_ms) AS totalMs, " +
        "COALESCE(SUM(ROUND(duration_ms * rate_minor_at_start / 3600000.0)), 0) AS revenueMinor " +
        "FROM rental_sessions WHERE ended_at_utc IS NOT NULL GROUP BY business_day_id",
    );

    // One row per day — NOT a single un-grouped row (the regression this
    // guards: the generic count(*) branch used to swallow this query).
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.dayId).sort()).toEqual([1, 2]);

    const first = rows.find((r) => r.dayId === 1)!;
    expect(first.count).toBe(1);
    expect(first.totalMs).toBe(3_600_000);
    expect(first.revenueMinor).toBe(2000);

    const second = rows.find((r) => r.dayId === 2)!;
    expect(second.count).toBe(1);
    expect(second.totalMs).toBe(7_200_000);
    expect(second.revenueMinor).toBe(8000);
  });

  it("returns one row per station for the per-station GROUP BY query", async () => {
    const db = createMemoryPort();
    await seedSessions(db);

    const rows = await db.select<{
      stationId: number;
      count: number;
      totalMs: number;
    }>(
      "SELECT station_id AS stationId, COUNT(*) AS count, SUM(duration_ms) AS totalMs " +
        "FROM rental_sessions WHERE business_day_id = ? AND ended_at_utc IS NOT NULL GROUP BY station_id",
      [1],
    );

    // The generic "completed sessions for ONE station" branch used to
    // swallow this query and return raw session rows instead of aggregates.
    expect(rows.length).toBe(1);
    expect(rows[0]!.count).toBe(1);
    expect(rows[0]!.totalMs).toBe(3_600_000);
  });
});

describe("schema migrations", () => {
  beforeEach(resetDb);

  it("creates schema_meta at version 1 when initialized", async () => {
    const db = createMemoryPort();
    await db.execute("INSERT INTO schema_meta(version) VALUES (1)");
    const rows = await db.select<{ version: number }>(
      "SELECT version FROM schema_meta",
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.version).toBe(1);
  });

  it("is idempotent across new port instances", async () => {
    const db1 = createMemoryPort();
    await db1.execute("INSERT INTO schema_meta(version) VALUES (1)");
    const db2 = createMemoryPort();
    const rows = await db2.select<{ version: number }>(
      "SELECT version FROM schema_meta",
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.version).toBe(1);
  });
});
