/** Migration ledger. v1 = full DDL (also in schema.sql). Additive only going forward. */

export interface Migration {
  version: number;
  name: string;
  sql: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial-schema",
    sql: [
      `CREATE TABLE IF NOT EXISTS business_days(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at_utc INTEGER NOT NULL,
        ended_at_utc INTEGER NULL CHECK(ended_at_utc IS NULL OR ended_at_utc > started_at_utc),
        created_at_utc INTEGER NOT NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_open_day ON business_days(ended_at_utc) WHERE ended_at_utc IS NULL`,
      `CREATE TABLE IF NOT EXISTS stations(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
        color_hex TEXT NOT NULL DEFAULT '#2ee6ff',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_visible INTEGER NOT NULL DEFAULT 1 CHECK(is_visible IN (0,1)),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
        hourly_rate_minor INTEGER NOT NULL DEFAULT 0 CHECK(hourly_rate_minor >= 0),
        created_at_utc INTEGER NOT NULL,
        updated_at_utc INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS rental_sessions(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        station_id INTEGER NOT NULL REFERENCES stations(id),
        business_day_id INTEGER NOT NULL REFERENCES business_days(id),
        started_at_utc INTEGER NOT NULL,
        ended_at_utc INTEGER NULL CHECK(ended_at_utc IS NULL OR ended_at_utc >= started_at_utc),
        duration_ms INTEGER NULL CHECK(duration_ms IS NULL OR duration_ms >= 0),
        rate_minor_at_start INTEGER NULL CHECK(rate_minor_at_start IS NULL OR (rate_minor_at_start = CAST(rate_minor_at_start AS INTEGER) AND rate_minor_at_start >= 0))
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_active_session_per_station
        ON rental_sessions(station_id) WHERE ended_at_utc IS NULL`,
      `CREATE INDEX IF NOT EXISTS ix_sessions_day ON rental_sessions(business_day_id)`,
      `CREATE INDEX IF NOT EXISTS ix_sessions_station ON rental_sessions(station_id)`,
      `CREATE TABLE IF NOT EXISTS app_settings(
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at_utc INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS schema_meta(version INTEGER NOT NULL)`,
    ],
  },
  {
    version: 2,
    name: "per-device-hourly-pricing",
    sql: [
      // Additive upgrade for pre-pricing installs. Existing stations keep
      // hourly_rate_minor = 0 (unpriced) — their intended price is unknown,
      // so it must be configured explicitly rather than guessed.
      // Existing sessions keep rate_minor_at_start = NULL (legacy/unpriced).
      `ALTER TABLE stations ADD COLUMN hourly_rate_minor INTEGER NOT NULL DEFAULT 0 CHECK(hourly_rate_minor >= 0)`,
      `ALTER TABLE rental_sessions ADD COLUMN rate_minor_at_start INTEGER NULL CHECK(rate_minor_at_start IS NULL OR (rate_minor_at_start = CAST(rate_minor_at_start AS INTEGER) AND rate_minor_at_start >= 0))`,
    ],
  },
];

export const CURRENT_SCHEMA_VERSION =
  MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 1;
