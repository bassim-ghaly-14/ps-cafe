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
      const t = JSON.parse(raw) as Tables;
      if (Array.isArray(t.business_days)) return t;
    }
  } catch {
    /* fresh start */
  }
  return {
    business_days: [],
    stations: [],
    rental_sessions: [],
    schema_meta: [],
  };
}

function saveTables(key: string | null, t: Tables): void {
  if (key === null) return;
  try {
    localStorage.setItem(key, JSON.stringify(t));
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

/** localStorage-backed interpreter for the exact SQL subset repos use. */
export function createMemoryPort(options: MemoryPortOptions = {}): DbPort {
  const key = options.ephemeral ? null : (options.storageKey ?? MEM_KEY);
  const tables: Tables =
    key === null
      ? {
          business_days: [],
          stations: [],
          rental_sessions: [],
          schema_meta: [],
        }
      : loadTables(key);
  const persist = () => {
    if (key !== null) saveTables(key, tables);
  };
  const maxId = (rows: Row[]): number =>
    rows.reduce((m, r) => Math.max(m, (r["id"] as number) ?? 0), 0);
  let seqDay = maxId(tables.business_days);
  let seqStation = maxId(tables.stations);
  let seqSession = maxId(tables.rental_sessions);

  if (
    tables.stations.length === 0 &&
    tables.business_days.length === 0 &&
    tables.rental_sessions.length === 0
  ) {
    const now = Date.now();
    SEED.forEach((s, i) => {
      seqStation += 1;
      tables.stations.push({
        id: seqStation,
        name: s.name,
        color_hex: s.color,
        sort_order: i,
        is_visible: 1,
        is_active: 1,
        created_at_utc: now,
        updated_at_utc: now,
      });
    });
    persist();
  }

  async function execute(sql: string, params: unknown[] = []): Promise<void> {
    const q = norm(sql);
    const num = (i: number): number => {
      const v = params[i];
      if (typeof v !== "number" || !Number.isFinite(v))
        throw constraintError("Bad numeric param");
      return v;
    };
    const str = (i: number): string => String(params[i] ?? "");
    if (
      q.startsWith("pragma") ||
      q.startsWith("create table") ||
      q.startsWith("create unique index") ||
      q.startsWith("create index")
    ) {
      persist();
      return;
    }
    if (q.startsWith("insert into schema_meta")) {
      tables.schema_meta.push({ version: params.length ? num(0) : 1 });
      persist();
      return;
    }
    if (q.startsWith("insert into business_days")) {
      if (tables.business_days.some((r) => r["ended_at_utc"] === null)) {
        throw constraintError("UNIQUE failed: uq_open_day");
      }
      seqDay += 1;
      tables.business_days.push({
        id: seqDay,
        started_at_utc: num(0),
        ended_at_utc: null,
        created_at_utc: num(1),
      });
      persist();
      return;
    }
    if (q.startsWith("update business_days set ended_at_utc")) {
      const ended = num(0);
      const id = num(1);
      const row = tables.business_days.find(
        (r) => r["id"] === id && r["ended_at_utc"] === null,
      );
      if (!row)
        throw new RepoError(
          "NOT_FOUND",
          "Business day not found or already closed.",
        );
      if (!(ended > (row["started_at_utc"] as number)))
        throw constraintError("CHECK failed: end > start");
      const active = tables.rental_sessions.filter(
        (s) => s["business_day_id"] === id && s["ended_at_utc"] === null,
      ).length;
      if (active > 0)
        throw new RepoError(
          "DAY_HAS_ACTIVE_SESSIONS",
          "Cannot close: sessions active.",
        );
      row["ended_at_utc"] = ended;
      persist();
      return;
    }
    if (q.startsWith("insert into stations")) {
      const name = str(0);
      if (name.length < 1 || name.length > 60)
        throw constraintError("CHECK stations.name length");
      seqStation += 1;
      if (params.length === 5) {
        // Production createStation() form:
        // (name, color_hex, sort_order, created_at_utc, updated_at_utc)
        // with is_visible=1, is_active=1 defaults from the SQL text.
        tables.stations.push({
          id: seqStation,
          name,
          color_hex: str(1),
          sort_order: num(2),
          is_visible: 1,
          is_active: 1,
          created_at_utc: num(3),
          updated_at_utc: num(4),
        });
        persist();
        return;
      }
      tables.stations.push({
        id: seqStation,
        name,
        color_hex: str(1),
        sort_order: num(2),
        is_visible: num(3),
        is_active: num(4),
        created_at_utc: num(5),
        updated_at_utc: num(6),
      });
      persist();
      return;
    }
    if (q.startsWith("update stations set")) {
      // UPDATE stations SET name=?, color_hex=?, is_visible=?, is_active=?,
      //   updated_at_utc=? WHERE id=?  (6 params, indices 0..5)
      const id = num(5);
      const row = tables.stations.find((r) => r["id"] === id);
      if (!row) throw new RepoError("NOT_FOUND", "Station not found.");
      const name = str(0);
      if (name.length < 1 || name.length > 60)
        throw constraintError("CHECK stations.name length");
      // Production SQLite coerces booleans/numbers for flag columns; accept
      // 0/1 numbers and true/false here.
      const flag = (i: number): number => {
        const v: unknown = params[i];
        if (v === 1 || v === true) return 1;
        if (v === 0 || v === false) return 0;
        throw constraintError("Bad flag param");
      };
      const isVisible = flag(2);
      const isActive = flag(3);
      if (
        isActive === 0 &&
        tables.rental_sessions.some(
          (s) => s["station_id"] === id && s["ended_at_utc"] === null,
        )
      ) {
        throw new RepoError(
          "STATION_HAS_ACTIVE_SESSION",
          "Stop the active session first.",
        );
      }
      row["name"] = name;
      row["color_hex"] = str(1);
      row["is_visible"] = isVisible;
      row["is_active"] = isActive;
      row["updated_at_utc"] = num(4);
      persist();
      return;
    }
    if (q.startsWith("insert into rental_sessions")) {
      const stationId = num(0);
      const dayId = num(1);
      const started = num(2);
      const station = tables.stations.find((r) => r["id"] === stationId);
      if (!station || station["is_active"] !== 1)
        throw new RepoError("STATION_INACTIVE", "Station not eligible.");
      const day = tables.business_days.find(
        (r) => r["id"] === dayId && r["ended_at_utc"] === null,
      );
      if (!day) throw new RepoError("DAY_CLOSED", "No open business day.");
      if (
        tables.rental_sessions.some(
          (s) => s["station_id"] === stationId && s["ended_at_utc"] === null,
        )
      ) {
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
      });
      persist();
      return;
    }
    if (q.startsWith("update rental_sessions set ended_at_utc")) {
      const endTs = num(0);
      const dur = num(1);
      const id = num(2);
      const row = tables.rental_sessions.find(
        (r) => r["id"] === id && r["ended_at_utc"] === null,
      );
      if (!row) throw new RepoError("NOT_FOUND", "Active session not found.");
      if (!(endTs >= (row["started_at_utc"] as number)) || !(dur >= 0)) {
        throw constraintError("CHECK failed: session timestamps");
      }
      row["ended_at_utc"] = endTs;
      row["duration_ms"] = dur;
      persist();
      return;
    }
    throw new RepoError(
      "UNSUPPORTED_SQL",
      "Memory backend cannot execute statement.",
    );
  }

  async function select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const q = norm(sql);
    const num = (i: number): number => params[i] as number;
    const rows = (r: Record<string, unknown>[]): T[] => r as unknown as T[];
    if (q === "select version from schema_meta") {
      return rows(tables.schema_meta.map((r) => ({ ...r })));
    }
    if (q.includes("from business_days where ended_at_utc is null")) {
      return rows(
        tables.business_days
          .filter((r) => r["ended_at_utc"] === null)
          .map((r) => ({ ...r })),
      );
    }
    if (q.includes("from business_days order by id desc")) {
      return rows(
        [...tables.business_days]
          .sort(
            (a, b) => ((b["id"] as number) ?? 0) - ((a["id"] as number) ?? 0),
          )
          .map((r) => ({ ...r })),
      );
    }
    if (q.includes("from business_days") && q.includes("count(*)")) {
      const n = tables.business_days.filter(
        (r) => r["ended_at_utc"] !== null,
      ).length;
      return rows([{ count: n }] as unknown as Record<string, unknown>[]);
    }
    if (q.includes("from business_days where id")) {
      return rows(
        tables.business_days
          .filter((r) => r["id"] === num(0))
          .map((r) => ({ ...r })),
      );
    }
    if (q.includes("from stations order by sort_order")) {
      const sorted = [...tables.stations].sort(
        (a, b) =>
          ((a["sort_order"] as number) ?? 0) -
            ((b["sort_order"] as number) ?? 0) ||
          ((a["id"] as number) ?? 0) - ((b["id"] as number) ?? 0),
      );
      return rows(sorted.map((r) => ({ ...r })));
    }
    if (q.includes("max(sort_order)") && q.includes("from stations")) {
      const m = tables.stations.reduce(
        (a, r) => Math.max(a, (r["sort_order"] as number) ?? -1),
        -1,
      );
      return rows([{ maxOrder: m }] as unknown as Record<string, unknown>[]);
    }
    if (q.includes("from stations where id")) {
      return rows(
        tables.stations
          .filter((r) => r["id"] === num(0))
          .map((r) => ({ ...r })),
      );
    }
    if (q.includes("from stations where is_active")) {
      const filtered = tables.stations.filter((r) => r["is_active"] === 1);
      if (q.includes("order by id")) {
        filtered.sort(
          (a, b) => ((a["id"] as number) ?? 0) - ((b["id"] as number) ?? 0),
        );
      }
      return rows(filtered.map((r) => ({ ...r })));
    }
    if (q.includes("from stations")) {
      return rows(tables.stations.map((r) => ({ ...r })));
    }
    if (q.includes("from rental_sessions where station_id")) {
      return rows(
        tables.rental_sessions
          .filter(
            (r) => r["station_id"] === num(0) && r["ended_at_utc"] === null,
          )
          .map((r) => ({ ...r })),
      );
    }
    if (
      q.includes("from rental_sessions where business_day_id") &&
      q.includes("ended_at_utc is null")
    ) {
      const id = num(0);
      return rows(
        tables.rental_sessions
          .filter(
            (r) => r["business_day_id"] === id && r["ended_at_utc"] === null,
          )
          .map((r) => ({ ...r })),
      );
    }
    if (q.includes("from rental_sessions where ended_at_utc is null")) {
      return rows(
        tables.rental_sessions
          .filter((r) => r["ended_at_utc"] === null)
          .map((r) => ({ ...r })),
      );
    }
    if (
      q.includes("from rental_sessions") &&
      q.includes("count(*)") &&
      q.includes("business_day_id")
    ) {
      const id = num(0);
      const done = tables.rental_sessions.filter(
        (r) => r["business_day_id"] === id && r["ended_at_utc"] !== null,
      );
      const totalMs = done.reduce(
        (a, r) => a + ((r["duration_ms"] as number) ?? 0),
        0,
      );
      return rows([{ count: done.length, totalMs }] as unknown as Record<
        string,
        unknown
      >[]);
    }
    if (q.includes("from rental_sessions where business_day_id")) {
      const id = num(0);
      return rows(
        tables.rental_sessions
          .filter((r) => r["business_day_id"] === id)
          .map((r) => ({ ...r })),
      );
    }
    if (q.includes("from rental_sessions") && q.includes("count(*)")) {
      const done = tables.rental_sessions.filter(
        (r) => r["ended_at_utc"] !== null,
      );
      const totalMs = done.reduce(
        (a, r) => a + ((r["duration_ms"] as number) ?? 0),
        0,
      );
      return rows([{ count: done.length, totalMs }] as unknown as Record<
        string,
        unknown
      >[]);
    }
    if (q.includes("group by station_id")) {
      const id = num(0);
      const map = new Map<number, { count: number; totalMs: number }>();
      for (const s of tables.rental_sessions) {
        if (s["business_day_id"] !== id || s["ended_at_utc"] === null) continue;
        const sid = s["station_id"] as number;
        const e = map.get(sid) ?? { count: 0, totalMs: 0 };
        e.count += 1;
        e.totalMs += (s["duration_ms"] as number) ?? 0;
        map.set(sid, e);
      }
      const out = [...map.entries()].map(([stationId, v]) => ({
        stationId,
        count: v.count,
        totalMs: v.totalMs,
      }));
      return rows(out as unknown as Record<string, unknown>[]);
    }
    if (q.includes("from rental_sessions where id")) {
      return rows(
        tables.rental_sessions
          .filter((r) => r["id"] === num(0))
          .map((r) => ({ ...r })),
      );
    }
    throw new RepoError("UNSUPPORTED_SQL", "Memory backend cannot run select.");
  }

  return { execute, select };
}
