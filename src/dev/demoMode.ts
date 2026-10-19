import type { DbPort } from "../db/port";
import { createIsolatedDemoDb, setDbOverride } from "../db/client";
import {
  HOUR_MS,
  MIN_MS,
  closeDemoDay,
  completedSession,
  openDemoDay,
  stationIds,
  type DemoScenarioId,
} from "./demoSeed";

export type { DemoScenarioId };
export { DEMO_SCENARIOS, isDemoScenario } from "./demoSeed";

/** Seed a coherent synthetic dataset through the demo DbPort directly. */
export async function seedDemoScenario(
  db: DbPort,
  scenario: DemoScenarioId,
  nowUtc: number = Date.now(),
): Promise<void> {
  if (scenario === "empty") {
    await hideAllStations(db);
    return;
  }
  if (scenario === "open-empty") {
    await openDemoDay(db, nowUtc - 30 * MIN_MS);
    return;
  }
  if (scenario === "closed-history") {
    await seedHistory(db, nowUtc);
    return;
  }
  if (scenario === "open-busy") {
    await seedHistory(db, nowUtc);
    const openId = await openDemoDay(db, nowUtc - 45 * MIN_MS);
    await startDemoSessions(db, openId, nowUtc, [0, 1, 3], [20, 12, 5]);
    return;
  }
  if (scenario === "blocked-close") {
    await seedHistory(db, nowUtc);
    const openId = await openDemoDay(db, nowUtc - 90 * MIN_MS);
    await startDemoSessions(db, openId, nowUtc, [0, 2], [70, 40]);
    return;
  }
  await seedHistory(db, nowUtc);
  const openId = await openDemoDay(db, nowUtc - 50 * MIN_MS);
  await startDemoSessions(db, openId, nowUtc, [0, 1], [35, 18]);
}

async function hideAllStations(db: DbPort): Promise<void> {
  const ids = await stationIds(db);
  for (const id of ids) {
    await db.execute(
      "UPDATE stations SET name = ?, color_hex = ?, is_visible = ?, is_active = ?, updated_at_utc = ? WHERE id = ?",
      [`station-${id}`, "#2ee6ff", 0, 0, Date.now(), id],
    );
  }
}

async function seedHistory(db: DbPort, nowUtc: number): Promise<void> {
  const ids = await stationIds(db);
  const s = (i: number): number => ids[i % Math.max(1, ids.length)] ?? 1;
  // History days are opened, filled with completed sessions, then closed —
  // in that order — because the memory + SQLite layers only accept session
  // inserts against an OPEN day (same constraint as production).
  const aStart = nowUtc - 3 * 24 * HOUR_MS - 6 * HOUR_MS;
  const a = await openDemoDay(db, aStart);
  await completedSession(db, s(0), a, aStart + 1 * HOUR_MS, 90 * MIN_MS);
  await completedSession(db, s(1), a, aStart + 2 * HOUR_MS, 45 * MIN_MS);
  await completedSession(db, s(0), a, aStart + 4 * HOUR_MS, 60 * MIN_MS);
  await closeDemoDay(db, a, aStart + 6 * HOUR_MS);
  // Midnight-spanning day: 22:00 -> 03:20.
  const bStart = nowUtc - 1 * 24 * HOUR_MS - 5 * HOUR_MS - 20 * MIN_MS;
  const b = await openDemoDay(db, bStart);
  await completedSession(db, s(2), b, bStart + 10 * MIN_MS, 3 * HOUR_MS);
  await completedSession(db, s(3), b, bStart + 30 * MIN_MS, 2 * HOUR_MS);
  await closeDemoDay(db, b, bStart + 5 * HOUR_MS + 20 * MIN_MS);
  // Zero-session day.
  const cStart = nowUtc - 2 * 24 * HOUR_MS - 2 * HOUR_MS;
  const c = await openDemoDay(db, cStart);
  await closeDemoDay(db, c, cStart + 2 * HOUR_MS);
}

async function startDemoSessions(
  db: DbPort,
  dayId: number,
  nowUtc: number,
  stationIdx: number[],
  ageMin: number[],
): Promise<void> {
  const ids = await stationIds(db);
  for (let k = 0; k < stationIdx.length; k++) {
    const sid = ids[(stationIdx[k] ?? 0) % Math.max(1, ids.length)];
    if (typeof sid !== "number") continue;
    const stale = await db.select<{ id: number }>(
      "SELECT id FROM rental_sessions WHERE station_id = ? AND ended_at_utc IS NULL LIMIT 1",
      [sid],
    );
    for (const st of stale) {
      await db.execute(
        "UPDATE rental_sessions SET ended_at_utc = ?, duration_ms = ? WHERE id = ?",
        [nowUtc, 1 * MIN_MS, st.id],
      );
    }
    await db.execute(
      "INSERT INTO rental_sessions(station_id, business_day_id, started_at_utc, ended_at_utc, duration_ms) VALUES (?, ?, ?, NULL, NULL)",
      [sid, dayId, nowUtc - (ageMin[k] ?? 10) * MIN_MS],
    );
  }
}

export async function validateDemoConsistency(db: DbPort): Promise<string[]> {
  const problems: string[] = [];
  const openDays = await db.select<{ id: number }>(
    "SELECT id FROM business_days WHERE ended_at_utc IS NULL LIMIT 1",
  );
  const openId = openDays[0]?.id ?? null;
  const active = (await db.select<Record<string, unknown>>(
    "SELECT id FROM rental_sessions WHERE ended_at_utc IS NULL ORDER BY id ASC",
  )) as unknown as {
    id: number;
    station_id: number;
    business_day_id: number;
  }[];
  const stations = await db.select<{ id: number }>(
    "SELECT id FROM stations ORDER BY sort_order ASC, id ASC",
  );
  const stationSet = new Set(stations.map((r) => r.id));
  const days = await db.select<{ id: number }>(
    "SELECT id FROM business_days ORDER BY id DESC LIMIT (?)",
    [500],
  );
  const daySet = new Set(days.slice(0, 500).map((r) => r.id));
  for (const sess of active) {
    if (!stationSet.has(sess.station_id))
      problems.push(`session #${sess.id} references missing station`);
    if (!daySet.has(sess.business_day_id))
      problems.push(`session #${sess.id} references missing day`);
    if (openId !== null && sess.business_day_id !== openId)
      problems.push(`active session #${sess.id} is not on the open day`);
  }
  return problems;
}

export async function buildDemoDb(
  scenario: DemoScenarioId,
  nowUtc: number = Date.now(),
): Promise<DbPort> {
  const db = await createIsolatedDemoDb();
  await seedDemoScenario(db, scenario, nowUtc);
  return db;
}

export async function enterDemoMode(
  scenario: DemoScenarioId,
  nowUtc: number = Date.now(),
): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = await buildDemoDb(scenario, nowUtc);
    setDbOverride(db);
    return { ok: true };
  } catch (e) {
    setDbOverride(null);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function exitDemoMode(): Promise<void> {
  setDbOverride(null);
}
