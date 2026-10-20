import type { DbPort } from "./port";
import { RepoError } from "./port";

export const MEM_KEY = "pscafe.sqlite.fallback.v1";

type Row = Record<string, number | string | null>;

interface Tables {
  business_days: Row[];
  stations: Row[];
  rental_sessions: Row[];
  schema_meta: { version: number }[];
}

const SEED: { name: string; color: string }[] = [
  { name: "PS5 — جهاز 1", color: "#2ee6ff" },
  { name: "PS5 — جهاز 2", color: "#b36bff" },
  { name: "PS4 — جهاز 3", color: "#ff4d9d" },
  { name: "PS4 — جهاز 4", color: "#ffc233" },
];

function emptyTables(): Tables {
  return {
    business_days: [],
    stations: [],
    rental_sessions: [],
    schema_meta: [],
  };
}

export function __clearMemoryDb(): void {
  try {
    localStorage.removeItem(MEM_KEY);
  } catch {
    /* unavailable */
  }
}

export interface MemoryPortOptions {
  /** When true, never touches localStorage: fully isolated ephemeral DB. */
  ephemeral?: boolean;
  /** Override storage key (used only when ephemeral is false). */
  storageKey?: string;
}

function loadTables(key: string): Tables {
  try {
    const raw = localStorage.getItem(key);

    if (raw) {
      const tables = JSON.parse(raw) as Tables;

      if (Array.isArray(tables.business_days)) return tables;
    }
  } catch {
    /* fresh start */
  }

  return emptyTables();
}

function saveTables(key: string | null, tables: Tables): void {
  if (key === null) return;

  try {
    localStorage.setItem(key, JSON.stringify(tables));
  } catch {
    /* private mode */
  }
}

function norm(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function constraintError(message: string): RepoError {
  return new RepoError("CONSTRAINT", message);
}

function getNumericParam(params: unknown[], index: number): number {
  const value = params[index];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw constraintError("Bad numeric param");
  }

  return value;
}

function getStringParam(params: unknown[], index: number): string {
  return String(params[index] ?? "");
}

function getFlagParam(params: unknown[], index: number): number {
  const value = params[index];

  if (value === 1 || value === true) return 1;
  if (value === 0 || value === false) return 0;

  throw constraintError("Bad flag param");
}

function validateStationName(name: string): void {
  if (name.length < 1 || name.length > 60) {
    throw constraintError("CHECK stations.name length");
  }
}

function findRequiredRow(
  rows: Row[],
  predicate: (row: Row) => boolean,
  code: string,
  message: string,
): Row {
  const row = rows.find(predicate);

  if (!row) throw new RepoError(code, message);

  return row;
}

/** localStorage-backed interpreter for the exact SQL subset repos use. */
export function createMemoryPort(options: MemoryPortOptions = {}): DbPort {
  const key = options.ephemeral ? null : (options.storageKey ?? MEM_KEY);
  const tables = key === null ? emptyTables() : loadTables(key);

  const persist = (): void => saveTables(key, tables);

  const maxId = (rows: Row[]): number =>
    rows.reduce(
      (maximum, row) => Math.max(maximum, (row["id"] as number) ?? 0),
      0,
    );

  let seqDay = maxId(tables.business_days);
  let seqStation = maxId(tables.stations);
  let seqSession = maxId(tables.rental_sessions);

  seedInitialStations();

  function seedInitialStations(): void {
    if (
      tables.stations.length > 0 ||
      tables.business_days.length > 0 ||
      tables.rental_sessions.length > 0
    ) {
      return;
    }

    const now = Date.now();

    SEED.forEach((station, index) => {
      seqStation += 1;

      tables.stations.push({
        id: seqStation,
        name: station.name,
        color_hex: station.color,
        sort_order: index,
        is_visible: 1,
        is_active: 1,
        hourly_rate_minor: 0,
        created_at_utc: now,
        updated_at_utc: now,
      });
    });

    persist();
  }

  function insertSchemaMeta(params: unknown[]): void {
    tables.schema_meta.push({
      version: params.length ? getNumericParam(params, 0) : 1,
    });

    persist();
  }

  function insertBusinessDay(params: unknown[]): void {
    const hasOpenDay = tables.business_days.some(
      (row) => row["ended_at_utc"] === null,
    );

    if (hasOpenDay) {
      throw constraintError("UNIQUE failed: uq_open_day");
    }

    seqDay += 1;

    tables.business_days.push({
      id: seqDay,
      started_at_utc: getNumericParam(params, 0),
      ended_at_utc: null,
      created_at_utc: getNumericParam(params, 1),
    });

    persist();
  }

  function closeBusinessDay(params: unknown[]): void {
    const ended = getNumericParam(params, 0);
    const id = getNumericParam(params, 1);

    const row = findRequiredRow(
      tables.business_days,
      (item) => item["id"] === id && item["ended_at_utc"] === null,
      "NOT_FOUND",
      "Business day not found or already closed.",
    );

    if (!(ended > (row["started_at_utc"] as number))) {
      throw constraintError("CHECK failed: end > start");
    }

    const hasActiveSessions = tables.rental_sessions.some(
      (session) =>
        session["business_day_id"] === id && session["ended_at_utc"] === null,
    );

    if (hasActiveSessions) {
      throw new RepoError(
        "DAY_HAS_ACTIVE_SESSIONS",
        "Cannot close: sessions active.",
      );
    }

    row["ended_at_utc"] = ended;
    persist();
  }

  function getRateParam(params: unknown[], index: number): number {
    const value = params[index];
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 1_000_000
    ) {
      throw constraintError("CHECK failed: hourly_rate_minor >= 0");
    }
    return value;
  }

  function insertStation(params: unknown[]): void {
    const name = getStringParam(params, 0);
    validateStationName(name);

    seqStation += 1;

    if (params.length === 6) {
      // Production createStation() form:
      // (name, color_hex, sort_order, hourly_rate_minor, created_at_utc, updated_at_utc)
      // is_visible and is_active default to 1.
      tables.stations.push({
        id: seqStation,
        name,
        color_hex: getStringParam(params, 1),
        sort_order: getNumericParam(params, 2),
        is_visible: 1,
        is_active: 1,
        hourly_rate_minor: getRateParam(params, 3),
        created_at_utc: getNumericParam(params, 4),
        updated_at_utc: getNumericParam(params, 5),
      });
    } else if (params.length === 5) {
      // Legacy (pre-pricing) form — default rate to 0 (unpriced).
      tables.stations.push({
        id: seqStation,
        name,
        color_hex: getStringParam(params, 1),
        sort_order: getNumericParam(params, 2),
        is_visible: 1,
        is_active: 1,
        hourly_rate_minor: 0,
        created_at_utc: getNumericParam(params, 3),
        updated_at_utc: getNumericParam(params, 4),
      });
    } else {
      tables.stations.push({
        id: seqStation,
        name,
        color_hex: getStringParam(params, 1),
        sort_order: getNumericParam(params, 2),
        is_visible: getNumericParam(params, 3),
        is_active: getNumericParam(params, 4),
        hourly_rate_minor: 0,
        created_at_utc: getNumericParam(params, 5),
        updated_at_utc: getNumericParam(params, 6),
      });
    }

    persist();
  }

  function updateStation(params: unknown[]): void {
    // UPDATE stations ... WHERE id=? (7 params, indices 0..6)
    const id = getNumericParam(params, 6);

    const row = findRequiredRow(
      tables.stations,
      (station) => station["id"] === id,
      "NOT_FOUND",
      "Station not found.",
    );

    const name = getStringParam(params, 0);
    validateStationName(name);

    const isVisible = getFlagParam(params, 2);
    const isActive = getFlagParam(params, 3);
    const rate = getRateParam(params, 4);

    // An active rental prevents deactivating its station.
    const hasActiveSession = tables.rental_sessions.some(
      (session) =>
        session["station_id"] === id && session["ended_at_utc"] === null,
    );

    if (isActive === 0 && hasActiveSession) {
      throw new RepoError(
        "STATION_HAS_ACTIVE_SESSION",
        "Stop the active session first.",
      );
    }

    row["name"] = name;
    row["color_hex"] = getStringParam(params, 1);
    row["is_visible"] = isVisible;
    row["is_active"] = isActive;
    row["hourly_rate_minor"] = rate;
    row["updated_at_utc"] = getNumericParam(params, 5);

    persist();
  }

  function insertRentalSession(params: unknown[]): void {
    const stationId = getNumericParam(params, 0);
    const dayId = getNumericParam(params, 1);
    const started = getNumericParam(params, 2);
    // params[3] is the rate snapshot for post-pricing inserts; legacy
    // inserts have only 3 params and default to NULL (unpriced).
    const snapshot =
      params.length >= 4
        ? getRateParam(params, 3)
        : (null as unknown as number);

    const station = tables.stations.find((row) => row["id"] === stationId);

    if (!station || station["is_active"] !== 1) {
      throw new RepoError("STATION_INACTIVE", "Station not eligible.");
    }

    const day = tables.business_days.find(
      (row) => row["id"] === dayId && row["ended_at_utc"] === null,
    );

    if (!day) {
      throw new RepoError("DAY_CLOSED", "No open business day.");
    }

    const hasActiveSession = tables.rental_sessions.some(
      (session) =>
        session["station_id"] === stationId && session["ended_at_utc"] === null,
    );

    if (hasActiveSession) {
      throw constraintError("UNIQUE failed: uq_active_session_per_station");
    }

    seqSession += 1;

    tables.rental_sessions.push({
      id: seqSession,
      station_id: stationId,
      business_day_id: dayId,
      started_at_utc: started,
      ended_at_utc: null,
      duration_ms: null,
      rate_minor_at_start: snapshot,
    });

    persist();
  }

  function closeRentalSession(params: unknown[]): void {
    const endTs = getNumericParam(params, 0);
    const duration = getNumericParam(params, 1);
    const id = getNumericParam(params, 2);

    const row = findRequiredRow(
      tables.rental_sessions,
      (session) => session["id"] === id && session["ended_at_utc"] === null,
      "NOT_FOUND",
      "Active session not found.",
    );

    if (!(endTs >= (row["started_at_utc"] as number)) || !(duration >= 0)) {
      throw constraintError("CHECK failed: session timestamps");
    }

    row["ended_at_utc"] = endTs;
    row["duration_ms"] = duration;

    persist();
  }

  async function execute(sql: string, params: unknown[] = []): Promise<void> {
    const query = norm(sql);

    if (isSchemaStatement(query)) {
      persist();
      return;
    }

    if (query.startsWith("insert into schema_meta")) {
      insertSchemaMeta(params);
      return;
    }

    if (query.startsWith("insert into business_days")) {
      insertBusinessDay(params);
      return;
    }

    if (query.startsWith("update business_days set ended_at_utc")) {
      closeBusinessDay(params);
      return;
    }

    if (query.startsWith("insert into stations")) {
      insertStation(params);
      return;
    }

    if (query.startsWith("update stations set")) {
      updateStation(params);
      return;
    }

    if (query.startsWith("insert into rental_sessions")) {
      insertRentalSession(params);
      return;
    }

    if (query.startsWith("update rental_sessions set ended_at_utc")) {
      closeRentalSession(params);
      return;
    }

    throw new RepoError(
      "UNSUPPORTED_SQL",
      "Memory backend cannot execute statement.",
    );
  }

  return { execute, select };

  function isSchemaStatement(query: string): boolean {
    return (
      query.startsWith("pragma") ||
      query.startsWith("create table") ||
      query.startsWith("create unique index") ||
      query.startsWith("create index") ||
      // Pricing migration: memory rows are schemaless records, so ALTER
      // TABLE ADD COLUMN is a no-op (rows simply carry the new keys).
      query.startsWith("alter table")
    );
  }

  async function select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const query = norm(sql);
    const num = (index: number): number => params[index] as number;

    const rows = (items: Record<string, unknown>[]): T[] =>
      items as unknown as T[];

    if (query === "select version from schema_meta") {
      return rows(tables.schema_meta.map((row) => ({ ...row })));
    }

    if (query.includes("from business_days where ended_at_utc is null")) {
      return rows(
        tables.business_days
          .filter((row) => row["ended_at_utc"] === null)
          .map((row) => ({ ...row })),
      );
    }

    if (query.includes("from business_days order by id desc")) {
      return rows(
        [...tables.business_days]
          .sort(
            (a, b) => ((b["id"] as number) ?? 0) - ((a["id"] as number) ?? 0),
          )
          .map((row) => ({ ...row })),
      );
    }

    if (query.includes("from business_days") && query.includes("count(*)")) {
      const count = tables.business_days.filter(
        (row) => row["ended_at_utc"] !== null,
      ).length;

      return rows([{ count }]);
    }

    if (query.includes("from business_days where id")) {
      return rows(
        tables.business_days
          .filter((row) => row["id"] === num(0))
          .map((row) => ({ ...row })),
      );
    }

    if (query.includes("from stations order by sort_order")) {
      const sorted = [...tables.stations].sort(
        (a, b) =>
          ((a["sort_order"] as number) ?? 0) -
            ((b["sort_order"] as number) ?? 0) ||
          ((a["id"] as number) ?? 0) - ((b["id"] as number) ?? 0),
      );

      return rows(sorted.map((row) => ({ ...row })));
    }

    if (query.includes("max(sort_order)") && query.includes("from stations")) {
      const maxOrder = tables.stations.reduce(
        (maximum, row) =>
          Math.max(maximum, (row["sort_order"] as number) ?? -1),
        -1,
      );

      return rows([{ maxOrder }]);
    }

    if (query.includes("from stations where id")) {
      return rows(
        tables.stations
          .filter((row) => row["id"] === num(0))
          .map((row) => ({ ...row })),
      );
    }

    if (query.includes("from stations where is_active")) {
      const filtered = tables.stations.filter((row) => row["is_active"] === 1);

      if (query.includes("order by id")) {
        filtered.sort(
          (a, b) => ((a["id"] as number) ?? 0) - ((b["id"] as number) ?? 0),
        );
      }

      return rows(filtered.map((row) => ({ ...row })));
    }

    if (query.includes("from stations")) {
      return rows(tables.stations.map((row) => ({ ...row })));
    }

    // Aggregated queries must be matched BEFORE the generic rental_sessions
    // branches below: they also mention `station_id` / `count(*)` /
    // `business_day_id`, and those generic branches would otherwise swallow
    // the GROUP BY query and return the wrong shape (raw session rows or a
    // single un-grouped row instead of one row per group).
    //
    // Per-day aggregates for ALL closed workdays in a single pass — used by
    // the workday history table so each row gets only its own sessions.
    if (query.includes("group by business_day_id")) {
      const aggregates = new Map<
        number,
        { count: number; totalMs: number; revenueMinor: number }
      >();

      for (const session of tables.rental_sessions) {
        if (session["ended_at_utc"] === null) continue;

        const dayId = (session["business_day_id"] as number) ?? 0;
        let aggregate = aggregates.get(dayId);
        if (!aggregate) {
          aggregate = { count: 0, totalMs: 0, revenueMinor: 0 };
          aggregates.set(dayId, aggregate);
        }

        const duration = (session["duration_ms"] as number) ?? 0;
        aggregate.count += 1;
        aggregate.totalMs += duration;

        const rate = session["rate_minor_at_start"];
        if (typeof rate === "number" && typeof duration === "number") {
          aggregate.revenueMinor += Math.round((duration * rate) / 3_600_000);
        }
      }

      return rows(
        [...aggregates.entries()].map(([dayId, aggregate]) => ({
          dayId,
          ...aggregate,
        })),
      );
    }

    // Per-station aggregate for ONE business day.
    if (query.includes("group by station_id")) {
      const id = num(0);
      const aggregates = new Map<number, { count: number; totalMs: number }>();

      for (const session of tables.rental_sessions) {
        if (
          session["business_day_id"] !== id ||
          session["ended_at_utc"] === null
        ) {
          continue;
        }

        const stationId = session["station_id"] as number;
        const aggregate = aggregates.get(stationId) ?? {
          count: 0,
          totalMs: 0,
        };

        aggregate.count += 1;
        aggregate.totalMs += (session["duration_ms"] as number) ?? 0;

        aggregates.set(stationId, aggregate);
      }

      const result = [...aggregates.entries()].map(
        ([stationId, aggregate]) => ({
          stationId,
          count: aggregate.count,
          totalMs: aggregate.totalMs,
        }),
      );

      return rows(result);
    }

    // Completed sessions for ONE station (details-page aggregate source).
    // Must precede the generic station_id branch below, which only matches
    // active (ended_at_utc IS NULL) sessions.
    if (
      query.includes("from rental_sessions") &&
      query.includes("station_id") &&
      query.includes("ended_at_utc is not null")
    ) {
      const id = num(0);
      const completed = tables.rental_sessions
        .filter(
          (row) => row["station_id"] === id && row["ended_at_utc"] !== null,
        )
        .sort((a, b) => ((a["id"] as number) ?? 0) - ((b["id"] as number) ?? 0))
        .map((row) => ({ ...row }));
      return rows(completed);
    }

    // Paginated, newest-first history for ONE station. Supports LIMIT/OFFSET
    // params; slices defensively since not every driver binds LIMIT.
    if (
      query.includes("from rental_sessions") &&
      query.includes("station_id") &&
      query.includes("order by started_at_utc desc")
    ) {
      const id = num(0);
      const limit = typeof params[1] === "number" ? (params[1] as number) : 20;
      const offset = typeof params[2] === "number" ? (params[2] as number) : 0;
      const sorted = tables.rental_sessions
        .filter((row) => row["station_id"] === id)
        .sort(
          (a, b) =>
            ((b["started_at_utc"] as number) ?? 0) -
              ((a["started_at_utc"] as number) ?? 0) ||
            ((b["id"] as number) ?? 0) - ((a["id"] as number) ?? 0),
        );
      return rows(
        sorted.slice(offset, offset + limit).map((row) => ({ ...row })),
      );
    }

    // COUNT for ONE station's history total. Must precede the generic
    // count(*) branches (day-scoped and all-time) below.
    if (
      query.includes("from rental_sessions") &&
      query.includes("count(*)") &&
      query.includes("station_id")
    ) {
      const id = num(0);
      const count = tables.rental_sessions.filter(
        (row) => row["station_id"] === id,
      ).length;
      return rows([{ count }]);
    }

    if (query.includes("from rental_sessions where station_id")) {
      return rows(
        tables.rental_sessions
          .filter(
            (row) =>
              row["station_id"] === num(0) && row["ended_at_utc"] === null,
          )
          .map((row) => ({ ...row })),
      );
    }

    if (
      query.includes("from rental_sessions where business_day_id") &&
      query.includes("ended_at_utc is null")
    ) {
      const id = num(0);

      return rows(
        tables.rental_sessions
          .filter(
            (row) =>
              row["business_day_id"] === id && row["ended_at_utc"] === null,
          )
          .map((row) => ({ ...row })),
      );
    }

    if (query.includes("from rental_sessions where ended_at_utc is null")) {
      return rows(
        tables.rental_sessions
          .filter((row) => row["ended_at_utc"] === null)
          .map((row) => ({ ...row })),
      );
    }

    if (
      query.includes("from rental_sessions") &&
      query.includes("count(*)") &&
      query.includes("business_day_id")
    ) {
      const id = num(0);

      const completed = tables.rental_sessions.filter(
        (row) => row["business_day_id"] === id && row["ended_at_utc"] !== null,
      );

      let totalMs = 0;
      let revenueMinor = 0;
      for (const row of completed) {
        const duration = (row["duration_ms"] as number) ?? 0;
        totalMs += duration;
        const rate = row["rate_minor_at_start"];
        if (typeof rate === "number" && typeof duration === "number") {
          revenueMinor += Math.round((duration * rate) / 3_600_000);
        }
      }

      return rows([{ count: completed.length, totalMs, revenueMinor }]);
    }

    if (query.includes("from rental_sessions where business_day_id")) {
      const id = num(0);

      return rows(
        tables.rental_sessions
          .filter((row) => row["business_day_id"] === id)
          .map((row) => ({ ...row })),
      );
    }

    if (query.includes("from rental_sessions") && query.includes("count(*)")) {
      const completed = tables.rental_sessions.filter(
        (row) => row["ended_at_utc"] !== null,
      );

      const totalMs = completed.reduce(
        (total, row) => total + ((row["duration_ms"] as number) ?? 0),
        0,
      );

      return rows([{ count: completed.length, totalMs }]);
    }

    if (query.includes("from rental_sessions where id")) {
      return rows(
        tables.rental_sessions
          .filter((row) => row["id"] === num(0))
          .map((row) => ({ ...row })),
      );
    }

    throw new RepoError("UNSUPPORTED_SQL", "Memory backend cannot run select.");
  }
}
