import { getActiveDb } from "../db/client";
import { isValidTimestamp } from "../utils/time";
import type { BusinessDay } from "../domain/types";

interface Row {
  id: number;
  started_at_utc: number;
  ended_at_utc: number | null;
  created_at_utc: number;
}

function map(r: Row): BusinessDay {
  return {
    id: r.id,
    startedAtUtc: r.started_at_utc,
    endedAtUtc: r.ended_at_utc,
    createdAtUtc: r.created_at_utc,
  };
}

/** Startup-recovery sanitizer. Rows with missing/non-finite/non-positive
 * start timestamps can never produce a trustworthy elapsed value, so they
 * are excluded from the recovered state instead of rendering a corrupt
 * timer. History is never deleted here — the row stays in the table and
 * simply does not count as the recoverable open day.
 */
export function sanitizeRecoveredDays(rows: Row[]): Row[] {
  return rows.filter((r) => isValidTimestamp(r.started_at_utc));
}

/** All business-day SQL lives here. Components never import db/. */
export async function getOpenDay(): Promise<BusinessDay | null> {
  const db = await getActiveDb();
  const rows = await db.select<Row>(
    "SELECT * FROM business_days WHERE ended_at_utc IS NULL LIMIT 1",
  );
  const valid = sanitizeRecoveredDays(rows);
  const first = valid[0];
  return first ? map(first) : null;
}

export async function listDays(limit = 50): Promise<BusinessDay[]> {
  const db = await getActiveDb();
  const rows = await db.select<Row>(
    "SELECT * FROM business_days ORDER BY started_at_utc DESC, id DESC LIMIT (?)",
    [limit],
  );
  // LIMIT via placeholder is not supported by every driver — slice defensively.
  return rows.slice(0, limit).map(map);
}

/** Opens a day. Fails with CONSTRAINT when one is already open (double-click safe). */
export async function openDay(
  nowUtc: number = Date.now(),
): Promise<BusinessDay> {
  const db = await getActiveDb();
  const existing = await getOpenDay();
  if (existing)
    throw Object.assign(new Error("A business day is already open."), {
      code: "DAY_ALREADY_OPEN",
    });
  await db.execute(
    "INSERT INTO business_days(started_at_utc, created_at_utc) VALUES (?, ?)",
    [nowUtc, nowUtc],
  );
  const open = await getOpenDay();
  if (!open) throw new Error("Failed to open business day.");
  return open;
}

/**
 * Closes a day. The repository re-checks active sessions inside the update
 * path (the memory + SQLite layers both enforce it), so the rule holds even
 * if two close attempts race — never auto-force-stops stations.
 */
export async function closeDay(
  dayId: number,
  nowUtc: number = Date.now(),
): Promise<BusinessDay> {
  const db = await getActiveDb();
  await db.execute(
    "UPDATE business_days SET ended_at_utc = ? WHERE id = ? AND ended_at_utc IS NULL",
    [nowUtc, dayId],
  );
  const days = await listDays(200);
  const day = days.find((d) => d.id === dayId);
  if (!day || day.endedAtUtc === null)
    throw Object.assign(new Error("Business day is still open."), {
      code: "CLOSE_FAILED",
    });
  return day;
}

export async function countClosedDays(): Promise<number> {
  const db = await getActiveDb();
  const rows = await db.select<{ count: number }>(
    "SELECT COUNT(*) AS count FROM business_days WHERE ended_at_utc IS NOT NULL",
  );
  return rows[0]?.count ?? 0;
}
