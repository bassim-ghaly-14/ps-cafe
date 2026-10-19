import type { DbPort } from "./port";
import { RepoError } from "./port";
import { CURRENT_SCHEMA_VERSION, MIGRATIONS } from "./migrations";
import { createMemoryPort } from "./memory";

/**
 * Database entry point. Production (Tauri) uses real SQLite via
 * tauri-plugin-sql with the file in the app-data dir (never src/ or dist/).
 * Browser/dev + tests use the localStorage-backed memory port with the same
 * constraints so offline logic is exercised identically.
 *
 * Developer Mode can install an isolated override port (ephemeral in-memory
 * demo database) via setDbOverride(). All repositories resolve through
 * getActiveDb(), so demo traffic never touches the production database.
 */

let port: DbPort | null = null;
let initPromise: Promise<DbPort> | null = null;
let backend: "tauri" | "memory" = "memory";

/** Isolated demo database installed while Developer Mode is active. */
let overridePort: DbPort | null = null;

export function getBackend(): "tauri" | "memory" {
  return backend;
}

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/** Use App.tsx + all repositories call this. Safe to call repeatedly. */
export async function getDb(): Promise<DbPort> {
  if (port) return port;
  if (initPromise) return initPromise;

  initPromise = init();
  port = await initPromise;

  return port;
}

/**
 * Resolution point for every repository. When Developer Mode is active this
 * returns the isolated demo port; otherwise the real production database.
 * Never falls back across modes: a demo-port error propagates, it never
 * silently reads production data (and vice versa).
 */
export async function getActiveDb(): Promise<DbPort> {
  if (overridePort) return overridePort;
  return getDb();
}

/** Returns true while the isolated demo database is installed. */
export function isDemoDbActive(): boolean {
  return overridePort !== null;
}

/** Install or remove the isolated demo database override. */
export function setDbOverride(db: DbPort | null): void {
  overridePort = db;
}

/** Test helper: drop the singleton so each test gets a fresh DB. */
export function __resetDbForTests(): void {
  port = null;
  initPromise = null;
  overridePort = null;
}

/**
 * Build a fresh isolated demo database: ephemeral in-memory port (never
 * localStorage, never the production file) with migrations applied and the
 * default stations seeded. Callers then seed scenario data on top.
 */
export async function createIsolatedDemoDb(): Promise<DbPort> {
  const demo = createMemoryPort({ ephemeral: true });

  await runMigrations(demo);
  await seedDefaultStations(demo);

  return demo;
}

async function init(): Promise<DbPort> {
  if (isTauriRuntime()) {
    try {
      const mod = await import("@tauri-apps/plugin-sql");
      const Database = mod.default;
      const db = await Database.load("sqlite:ps-cafe.db");

      await db.execute("PRAGMA foreign_keys = ON");

      const tauriPort: DbPort = {
        execute: (sql, params) =>
          db.execute(sql, params as never[]).then(() => undefined),
        select: <T>(sql: string, params?: unknown[]) =>
          db.select<T[]>(sql, params as never[]) as Promise<T[]>,
      };

      await runMigrations(tauriPort);
      await seedDefaultStations(tauriPort);

      backend = "tauri";
      return tauriPort;
    } catch {
      // Preserve the existing fallback to the memory backend.
    }
  }

  const mem = createMemoryPort();

  await runMigrations(mem);
  await seedDefaultStations(mem);

  backend = "memory";
  return mem;
}

/** Read the latest schema version, treating an unavailable metadata table as version zero. */
async function readSchemaVersion(db: DbPort): Promise<number> {
  try {
    const rows = await db.select<{ version: number }>(
      "SELECT version FROM schema_meta",
    );

    return rows.reduce(
      (latest, row) => Math.max(latest, row.version),
      0,
    );
  } catch {
    return 0;
  }
}

/** Apply a single migration and record its version. */
async function applyMigration(
  db: DbPort,
  version: number,
  statements: readonly string[],
): Promise<void> {
  for (const statement of statements) {
    await db.execute(statement);
  }

  if (version === 1) {
    const rows = await db.select<{ version: number }>(
      "SELECT version FROM schema_meta",
    );

    if (rows.length === 0) {
      await db.execute("INSERT INTO schema_meta(version) VALUES (1)");
    }

    return;
  }

  await db.execute("INSERT INTO schema_meta(version) VALUES (?)", [version]);
}

async function runMigrations(db: DbPort): Promise<void> {
  await db.execute(
    "CREATE TABLE IF NOT EXISTS schema_meta(version INTEGER NOT NULL)",
  );

  let version = await readSchemaVersion(db);

  for (const migration of MIGRATIONS) {
    if (migration.version <= version) continue;

    await applyMigration(db, migration.version, migration.sql);
    version = migration.version;
  }

  if (version < CURRENT_SCHEMA_VERSION) {
    throw new RepoError(
      "MIGRATION_FAILED",
      "Database migration did not reach current version.",
    );
  }
}

/** First-run seed: 4 station cards matching the mockup lineup. */
async function seedDefaultStations(db: DbPort): Promise<void> {
  const existing = await db.select<{ id: number }>(
    "SELECT id FROM stations ORDER BY sort_order ASC, id ASC",
  );

  if (existing.length > 0) return;

  const now = Date.now();

  const seed: { name: string; color: string }[] = [
    { name: "PS5 — جهاز 1", color: "#2ee6ff" },
    { name: "PS5 — جهاز 2", color: "#b36bff" },
    { name: "PS4 — جهاز 3", color: "#ff4d9d" },
    { name: "PS4 — جهاز 4", color: "#ffc233" },
  ];

  for (let i = 0; i < seed.length; i++) {
    const station = seed[i];
    if (!station) continue;

    await db.execute(
      "INSERT INTO stations(name, color_hex, sort_order, is_visible, is_active, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [station.name, station.color, i, 1, 1, now, now],
    );
  }
}
