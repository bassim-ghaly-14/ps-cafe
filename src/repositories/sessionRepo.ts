import { getActiveDb } from "../db/client";
import { finalizeDurationMs, isValidTimestamp } from "../utils/time";
import type { RentalSession } from "../domain/types";

interface Row {
  id: number;
  station_id: number;
  business_day_id: number;
  started_at_utc: number;
  ended_at_utc: number | null;
  duration_ms: number | null;
}

function map(r: Row): RentalSession {
  return {
    id: r.id,
    stationId: r.station_id,
    businessDayId: r.business_day_id,
    startedAtUtc: r.started_at_utc,
    endedAtUtc: r.ended_at_utc,
    durationMs: r.duration_ms,
  };
}

/** Every session SQL statement lives here — no SQL in hooks or screens. */
export async function getActiveSession(
  stationId: number,
): Promise<RentalSession | null> {
  const db = await getActiveDb();
  const rows = await db.select<Row>(
    "SELECT * FROM rental_sessions WHERE station_id = ? AND ended_at_utc IS NULL LIMIT 1",
    [stationId],
  );
  const valid = rows.filter((r) => isValidTimestamp(r.started_at_utc));
  const first = valid[0];
  return first ? map(first) : null;
}

export async function listActiveSessions(): Promise<RentalSession[]> {
  const db = await getActiveDb();
  const rows = await db.select<Row>(
    "SELECT * FROM rental_sessions WHERE ended_at_utc IS NULL ORDER BY id ASC",
  );
  return rows.filter((r) => isValidTimestamp(r.started_at_utc)).map(map);
}

export async function listActiveSessionsForDay(
  dayId: number,
): Promise<RentalSession[]> {
  const db = await getActiveDb();
  const rows = await db.select<Row>(
    "SELECT * FROM rental_sessions WHERE business_day_id = ? AND ended_at_utc IS NULL ORDER BY id ASC",
    [dayId],
  );
  return rows.map(map);
}

export async function startSession(
  stationId: number,
  dayId: number,
  nowUtc: number = Date.now(),
): Promise<RentalSession> {
  const db = await getActiveDb();
  await db.execute(
    "INSERT INTO rental_sessions(station_id, business_day_id, started_at_utc, ended_at_utc, duration_ms) VALUES (?, ?, ?, NULL, NULL)",
    [stationId, dayId, nowUtc],
  );
  const active = await getActiveSession(stationId);
  if (!active) throw new Error("Failed to start session.");
  return active;
}

/** Persists end timestamp + duration atomically: duration = end - start. */
export async function stopSession(
  sessionId: number,
  nowUtc: number = Date.now(),
): Promise<RentalSession> {
  const db = await getActiveDb();
  const rows = await db.select<Row>(
    "SELECT * FROM rental_sessions WHERE ended_at_utc IS NULL ORDER BY id ASC",
  );
  const target = rows.find((r) => r.id === sessionId);
  if (!target)
    throw Object.assign(new Error("Active session not found."), {
      code: "NOT_FOUND",
    });
  const durationMs = finalizeDurationMs(target.started_at_utc, nowUtc);
  await db.execute(
    "UPDATE rental_sessions SET ended_at_utc = ?, duration_ms = ? WHERE id = ?",
    [nowUtc, durationMs, sessionId],
  );
  return {
    id: target.id,
    stationId: target.station_id,
    businessDayId: target.business_day_id,
    startedAtUtc: target.started_at_utc,
    endedAtUtc: nowUtc,
    durationMs,
  };
}

export interface DayAggregate {
  count: number;
  totalMs: number;
}

export async function aggregateForDay(dayId: number): Promise<DayAggregate> {
  const db = await getActiveDb();
  const rows = await db.select<{ count: number; totalMs: number | null }>(
    "SELECT COUNT(*) AS count, SUM(duration_ms) AS totalMs FROM rental_sessions WHERE business_day_id = ? AND ended_at_utc IS NOT NULL",
    [dayId],
  );
  const first = rows[0];
  return { count: first?.count ?? 0, totalMs: first?.totalMs ?? 0 };
}

export async function aggregateAllTime(): Promise<DayAggregate> {
  const db = await getActiveDb();
  const rows = await db.select<{ count: number; totalMs: number | null }>(
    "SELECT COUNT(*) AS count, SUM(duration_ms) AS totalMs FROM rental_sessions WHERE ended_at_utc IS NOT NULL",
  );
  const first = rows[0];
  return { count: first?.count ?? 0, totalMs: first?.totalMs ?? 0 };
}

export interface StationAggregate {
  stationId: number;
  count: number;
  totalMs: number;
}

export async function aggregateByStation(
  dayId: number,
): Promise<StationAggregate[]> {
  const db = await getActiveDb();
  const rows = await db.select<StationAggregate>(
    "SELECT station_id AS stationId, COUNT(*) AS count, SUM(duration_ms) AS totalMs FROM rental_sessions WHERE business_day_id = ? AND ended_at_utc IS NOT NULL GROUP BY station_id",
    [dayId],
  );
  return rows;
}
