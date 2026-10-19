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
