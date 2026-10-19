import type { DbPort } from "../db/port";

export type DemoScenarioId =
  | "full"
  | "empty"
  | "open-empty"
  | "open-busy"
  | "blocked-close"
  | "closed-history";

export const DEMO_SCENARIOS: { id: DemoScenarioId; labelKey: string }[] = [
  { id: "full", labelKey: "dev.scenarioFull" },
  { id: "empty", labelKey: "dev.scenarioEmpty" },
  { id: "open-empty", labelKey: "dev.scenarioOpenEmpty" },
  { id: "open-busy", labelKey: "dev.scenarioOpenBusy" },
  { id: "blocked-close", labelKey: "dev.scenarioBlockedClose" },
  { id: "closed-history", labelKey: "dev.scenarioClosedHistory" },
];

export function isDemoScenario(v: unknown): v is DemoScenarioId {
  return (
    v === "full" ||
    v === "empty" ||
    v === "open-empty" ||
    v === "open-busy" ||
    v === "blocked-close" ||
    v === "closed-history"
  );
}

export const HOUR_MS = 3_600_000;
export const MIN_MS = 60_000;

export async function stationIds(db: DbPort): Promise<number[]> {
  const r = await db.select<{ id: number }>(
    "SELECT id FROM stations ORDER BY sort_order ASC, id ASC",
  );
  return r.map((x: { id: number }) => x.id);
}

export async function openDemoDay(
  db: DbPort,
  startedAtUtc: number,
): Promise<number> {
  await db.execute(
    "INSERT INTO business_days(started_at_utc, created_at_utc) VALUES (?, ?)",
    [startedAtUtc, startedAtUtc],
  );
  const open = await db.select<{ id: number }>(
    "SELECT id FROM business_days WHERE ended_at_utc IS NULL LIMIT 1",
  );
  const id = open[0]?.id;
  if (typeof id !== "number") throw new Error("Failed to seed demo day.");
  return id;
}

export async function closeDemoDay(
  db: DbPort,
  dayId: number,
  endedAtUtc: number,
): Promise<void> {
  await db.execute(
    "UPDATE business_days SET ended_at_utc = ? WHERE id = ? AND ended_at_utc IS NULL",
    [endedAtUtc, dayId],
  );
}

/** Insert a completed session while its day is still open, then stop it. */
export async function completedSession(
  db: DbPort,
  stationId: number,
  dayId: number,
  startedAtUtc: number,
  durationMs: number,
): Promise<void> {
  const ended = startedAtUtc + durationMs;
  await db.execute(
    "INSERT INTO rental_sessions(station_id, business_day_id, started_at_utc, ended_at_utc, duration_ms) VALUES (?, ?, ?, NULL, NULL)",
    [stationId, dayId, startedAtUtc],
  );
  const active = await db.select<{ id: number }>(
    "SELECT id FROM rental_sessions WHERE station_id = ? AND ended_at_utc IS NULL LIMIT 1",
    [stationId],
  );
  const sid = active[0]?.id;
  if (typeof sid !== "number") throw new Error("Failed to seed session.");
  await db.execute(
    "UPDATE rental_sessions SET ended_at_utc = ?, duration_ms = ? WHERE id = ?",
    [ended, durationMs, sid],
  );
}
