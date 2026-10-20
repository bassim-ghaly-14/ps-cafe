import { getActiveDb } from "../db/client";
import { validateHourlyRateMinor } from "../domain/pricing";
import { finalizeDurationMs, isValidTimestamp } from "../utils/time";
import type { RentalSession } from "../domain/types";

interface Row {
  id: number;
  station_id: number;
  business_day_id: number;
  started_at_utc: number;
  ended_at_utc: number | null;
  duration_ms: number | null;
  rate_minor_at_start?: number | null;
}

function rateOf(r: Row): number | null {
  const v = r.rate_minor_at_start;
  if (v === null || v === undefined) return null;
  return validateHourlyRateMinor(v) ? v : null;
}

function map(r: Row): RentalSession {
  return {
    id: r.id,
    stationId: r.station_id,
    businessDayId: r.business_day_id,
    startedAtUtc: r.started_at_utc,
    endedAtUtc: r.ended_at_utc,
    durationMs: r.duration_ms,
    rateMinorAtStart: rateOf(r),
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
  // Snapshot the device's current configured rate into the session row so
  // later price edits can't rewrite this session's billable rate.
  // Legacy/unknown rate: snapshot 0 means unpriced at start, never NULL
  // for sessions created after the pricing migration.
  const stationRows = await db.select<{ hourly_rate_minor?: number | null }>(
    "SELECT hourly_rate_minor FROM stations WHERE id = ? LIMIT 1",
    [stationId],
  );
  const rawRate = stationRows[0]?.hourly_rate_minor;
  const snapshot =
    typeof rawRate === "number" && validateHourlyRateMinor(rawRate)
      ? rawRate
      : 0;
  await db.execute(
    "INSERT INTO rental_sessions(station_id, business_day_id, started_at_utc, ended_at_utc, duration_ms, rate_minor_at_start) VALUES (?, ?, ?, NULL, NULL, ?)",
    [stationId, dayId, nowUtc, snapshot],
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
    rateMinorAtStart: rateOf(target),
  };
}

export interface DayAggregate {
  count: number;
  totalMs: number;
  /**
   * Revenue attributable to the day in minor units (piasters, EGP).
   * Sum of round(duration_ms * rate_minor_at_start / 3_600_000) over the
   * day's completed sessions, using each session's own rate snapshot.
   * Legacy sessions with a NULL snapshot contribute time but not revenue.
   */
  revenueMinor: number;
}

export async function aggregateForDay(dayId: number): Promise<DayAggregate> {
  const db = await getActiveDb();
  const rows = await db.select<{
    count: number;
    totalMs: number | null;
    revenueMinor: number | null;
  }>(
    "SELECT COUNT(*) AS count, SUM(duration_ms) AS totalMs, " +
      "COALESCE(SUM(ROUND(duration_ms * rate_minor_at_start / 3600000.0)), 0) AS revenueMinor " +
      "FROM rental_sessions WHERE business_day_id = ? AND ended_at_utc IS NOT NULL",
    [dayId],
  );
  const first = rows[0];
  return {
    count: first?.count ?? 0,
    totalMs: first?.totalMs ?? 0,
    revenueMinor: first?.revenueMinor ?? 0,
  };
}

export interface DayHistoryAggregate extends DayAggregate {
  dayId: number;
}

/**
 * One aggregate query for every closed workday — no per-row queries.
 * Rows are keyed by business_day_id so each historical row receives only
 * its own sessions' metrics.
 */
export async function listDayAggregates(): Promise<DayHistoryAggregate[]> {
  const db = await getActiveDb();
  const rows = await db.select<{
    dayId: number;
    count: number;
    totalMs: number | null;
    revenueMinor: number | null;
  }>(
    "SELECT business_day_id AS dayId, COUNT(*) AS count, SUM(duration_ms) AS totalMs, " +
      "COALESCE(SUM(ROUND(duration_ms * rate_minor_at_start / 3600000.0)), 0) AS revenueMinor " +
      "FROM rental_sessions WHERE ended_at_utc IS NOT NULL GROUP BY business_day_id",
  );
  return rows.map((r) => ({
    dayId: r.dayId,
    count: r.count,
    totalMs: r.totalMs ?? 0,
    revenueMinor: r.revenueMinor ?? 0,
  }));
}

export async function aggregateAllTime(): Promise<DayAggregate> {
  const db = await getActiveDb();
  const rows = await db.select<{ count: number; totalMs: number | null }>(
    "SELECT COUNT(*) AS count, SUM(duration_ms) AS totalMs FROM rental_sessions WHERE ended_at_utc IS NOT NULL",
  );
  const first = rows[0];
  return {
    count: first?.count ?? 0,
    totalMs: first?.totalMs ?? 0,
    revenueMinor: 0,
  };
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

export interface StationHistoryAggregate {
  count: number;
  totalMs: number;
  revenueMinor: number;
  pricedCount: number;
}

/**
 * All-time totals for ONE station, scoped by its stable id.
 * revenueMinor sums round(duration*rate/3.6M) per completed session using
 * each session's own rate snapshot (never the current configured rate),
 * so price changes can't rewrite history. Legacy sessions with a NULL
 * snapshot are counted in count/totalMs but excluded from revenue.
 */
export async function aggregateForStation(
  stationId: number,
): Promise<StationHistoryAggregate> {
  const db = await getActiveDb();
  const rows = await db.select<{
    id: number;
    duration_ms: number | null;
    rate_minor_at_start?: number | null;
  }>(
    "SELECT id, duration_ms, rate_minor_at_start FROM rental_sessions WHERE station_id = ? AND ended_at_utc IS NOT NULL ORDER BY id ASC",
    [stationId],
  );
  let totalMs = 0;
  let revenueMinor = 0;
  let pricedCount = 0;
  for (const r of rows) {
    totalMs += r.duration_ms ?? 0;
    const rate =
      typeof r.rate_minor_at_start === "number" &&
      validateHourlyRateMinor(r.rate_minor_at_start)
        ? r.rate_minor_at_start
        : null;
    if (rate === null || typeof r.duration_ms !== "number") continue;
    revenueMinor += Math.round((r.duration_ms * rate) / 3_600_000);
    pricedCount += 1;
  }
  return { count: rows.length, totalMs, revenueMinor, pricedCount };
}

export interface StationHistoryPage {
  rows: RentalSession[];
  total: number;
}

/**
 * Newest-first session history for ONE station with stable id ordering.
 * Paginated — never loads unbounded history into memory.
 */
export async function listSessionsForStation(
  stationId: number,
  limit: number,
  offset: number,
): Promise<StationHistoryPage> {
  const db = await getActiveDb();
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit) || 20));
  const safeOffset = Math.max(0, Math.floor(offset) || 0);
  const totalRows = await db.select<{ count: number }>(
    "SELECT COUNT(*) AS count FROM rental_sessions WHERE station_id = ?",
    [stationId],
  );
  const rows = await db.select<Row>(
    "SELECT * FROM rental_sessions WHERE station_id = ? ORDER BY started_at_utc DESC, id DESC LIMIT ? OFFSET ?",
    [stationId, safeLimit, safeOffset],
  );
  return {
    rows: rows.map(map),
    total: totalRows[0]?.count ?? 0,
  };
}
