import { getBackend, isDemoDbActive, isLanClient } from "../db/client";
import * as businessDayRepo from "../repositories/businessDayRepo";
import * as sessionRepo from "../repositories/sessionRepo";

export const DATABASE_RESET_PHRASE = "DELETE ALL DATA";

export type DatabaseResetBlockReason =
  "LAN_CLIENT" | "DEMO_ACTIVE" | "LAN_RUNNING" | "OPEN_DAY" | "ACTIVE_SESSIONS";

export interface DatabaseResetBlock {
  reason: DatabaseResetBlockReason;
  detail?: string;
}

export interface DatabaseResetResult {
  ok: boolean;
  blocked?: DatabaseResetBlock;
  errorCode?: string;
  deleted?: { sessions: number; days: number; stations: number };
}

/**
 * Safety gate for the destructive database reset. Never deletes data —
 * only reports the first condition that must be resolved first.
 */
export async function checkDatabaseResetSafety(
  isLanRunning: () => boolean | Promise<boolean> = () => false,
): Promise<DatabaseResetBlock | null> {
  if (isLanClient()) return { reason: "LAN_CLIENT" };
  if (isDemoDbActive()) return { reason: "DEMO_ACTIVE" };
  let running = false;
  try {
    running = await isLanRunning();
  } catch {
    return { reason: "LAN_RUNNING", detail: "status-unknown" };
  }
  if (running) return { reason: "LAN_RUNNING" };
  if (getBackend() === "lan") return { reason: "LAN_CLIENT" };
  const active = await sessionRepo.listActiveSessions();
  if (active.length > 0) {
    return { reason: "ACTIVE_SESSIONS", detail: String(active.length) };
  }
  const open = await businessDayRepo.getOpenDay();
  if (open) return { reason: "OPEN_DAY", detail: String(open.id) };
  return null;
}

async function countRows(
  db: { select<T>(sql: string): Promise<T[]> },
  sql: string,
): Promise<number> {
  try {
    const rows = await db.select<{ count: number }>(sql);
    return rows[0]?.count ?? 0;
  } catch {
    return 0;
  }
}

async function restoreSnapshot(
  db: {
    execute(sql: string, params?: unknown[]): Promise<void>;
    select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  },
  snapshot: {
    sessions: Record<string, unknown>[];
    days: Record<string, unknown>[];
    stations: Record<string, unknown>[];
  },
): Promise<void> {
  const sessionsLeft = await countRows(
    db,
    "SELECT COUNT(*) AS count FROM rental_sessions",
  );
  const daysLeft = await countRows(
    db,
    "SELECT COUNT(*) AS count FROM business_days",
  );
  const stationsNow = await db.select<{ id: number }>(
    "SELECT id FROM stations",
  );
  const haveIds = new Set(stationsNow.map((s) => s.id));
  if (sessionsLeft === 0 && snapshot.sessions.length > 0) {
    for (const r of snapshot.sessions) {
      await db.execute(
        "INSERT INTO rental_sessions(id, station_id, business_day_id, started_at_utc, ended_at_utc, duration_ms, rate_minor_at_start) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          r["id"],
          r["station_id"],
          r["business_day_id"],
          r["started_at_utc"],
          r["ended_at_utc"],
          r["duration_ms"],
          r["rate_minor_at_start"],
        ],
      );
    }
  }
  if (daysLeft === 0 && snapshot.days.length > 0) {
    for (const r of snapshot.days) {
      await db.execute(
        "INSERT INTO business_days(id, started_at_utc, ended_at_utc, created_at_utc) VALUES (?, ?, ?, ?)",
        [r["id"], r["started_at_utc"], r["ended_at_utc"], r["created_at_utc"]],
      );
    }
  }
  for (const r of snapshot.stations) {
    if (haveIds.has(r["id"] as number)) continue;
    await db.execute(
      "INSERT INTO stations(id, name, color_hex, sort_order, is_visible, is_active, hourly_rate_minor, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        r["id"],
        r["name"],
        r["color_hex"],
        r["sort_order"],
        r["is_visible"],
        r["is_active"],
        r["hourly_rate_minor"] ?? 0,
        r["created_at_utc"],
        r["updated_at_utc"],
      ],
    );
  }
}

export async function resetDatabase(
  isLanRunning: () => boolean | Promise<boolean> = () => false,
): Promise<DatabaseResetResult> {
  const { getActiveDb } = await import("../db/client");
  const stationRepo = await import("../repositories/stationRepo");
  const blocked = await checkDatabaseResetSafety(isLanRunning);
  if (blocked) return { ok: false, blocked };
  const db = await getActiveDb();
  const before = {
    sessions: await countRows(
      db,
      "SELECT COUNT(*) AS count FROM rental_sessions",
    ),
    days: await countRows(db, "SELECT COUNT(*) AS count FROM business_days"),
    stations: await countRows(db, "SELECT COUNT(*) AS count FROM stations"),
  };
  const snapshot = {
    sessions: await db.select<Record<string, unknown>>(
      "SELECT * FROM rental_sessions",
    ),
    days: await db.select<Record<string, unknown>>(
      "SELECT * FROM business_days",
    ),
    stations: await db.select<Record<string, unknown>>(
      "SELECT * FROM stations",
    ),
  };
  try {
    const active = await sessionRepo.listActiveSessions();
    if (active.length > 0) {
      return {
        ok: false,
        blocked: { reason: "ACTIVE_SESSIONS", detail: String(active.length) },
      };
    }
    const open = await businessDayRepo.getOpenDay();
    if (open) {
      return {
        ok: false,
        blocked: { reason: "OPEN_DAY", detail: String(open.id) },
      };
    }
    await db.execute("DELETE FROM rental_sessions");
    await db.execute("DELETE FROM business_days");
    await db.execute("DELETE FROM stations");
    const client = await import("../db/client");
    await client.seedDefaultsForReset();
    const sessions = await countRows(
      db,
      "SELECT COUNT(*) AS count FROM rental_sessions",
    );
    const days = await countRows(
      db,
      "SELECT COUNT(*) AS count FROM business_days",
    );
    const stations = await stationRepo.listStations();
    const openAfter = await businessDayRepo.getOpenDay();
    const activeAfter = await sessionRepo.listActiveSessions();
    const meta = await db.select<{ version: number }>(
      "SELECT version FROM schema_meta",
    );
    if (
      sessions !== 0 ||
      days !== 0 ||
      openAfter !== null ||
      activeAfter.length !== 0 ||
      meta.length === 0 ||
      stations.length === 0
    ) {
      throw new Error("RESET_VERIFY_FAILED");
    }
    return { ok: true, deleted: before };
  } catch (e) {
    try {
      await restoreSnapshot(db, snapshot);
    } catch {
      /* recovery best-effort */
    }
    return {
      ok: false,
      errorCode: e instanceof Error ? e.message : "RESET_FAILED",
    };
  }
}
