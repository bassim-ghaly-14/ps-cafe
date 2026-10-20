import { getActiveDb } from "../db/client";
import { validateHourlyRateMinor } from "../domain/pricing";
import type { Station } from "../domain/types";

interface Row {
  id: number;
  name: string;
  color_hex: string;
  sort_order: number;
  is_visible: number;
  is_active: number;
  hourly_rate_minor?: number | null;
  created_at_utc: number;
  updated_at_utc: number;
}

function rateOf(r: Row): number {
  const v = r.hourly_rate_minor;
  return typeof v === "number" && validateHourlyRateMinor(v) ? v : 0;
}

function map(r: Row): Station {
  return {
    id: r.id,
    name: r.name,
    colorHex: r.color_hex,
    sortOrder: r.sort_order,
    isVisible: r.is_visible === 1,
    isActive: r.is_active === 1,
    hourlyRateMinor: rateOf(r),
    createdAtUtc: r.created_at_utc,
    updatedAtUtc: r.updated_at_utc,
  };
}

export async function listStations(): Promise<Station[]> {
  const db = await getActiveDb();
  const rows = await db.select<Row>(
    "SELECT * FROM stations ORDER BY sort_order ASC, id ASC",
  );
  return rows.map(map);
}

export async function getStation(id: number): Promise<Station | null> {
  const db = await getActiveDb();
  const rows = await db.select<Row>(
    "SELECT * FROM stations WHERE id = ? LIMIT 1",
    [id],
  );
  const first = rows[0];
  return first ? map(first) : null;
}

export async function createStation(
  name: string,
  colorHex: string,
  hourlyRateMinor: number = 0,
): Promise<Station> {
  if (!validateHourlyRateMinor(hourlyRateMinor)) {
    throw new Error("Invalid hourly rate.");
  }
  const db = await getActiveDb();
  const now = Date.now();
  const maxRows = await db.select<{ maxOrder: number }>(
    "SELECT MAX(sort_order) AS maxOrder FROM stations",
  );
  const order = (maxRows[0]?.maxOrder ?? -1) + 1;
  await db.execute(
    "INSERT INTO stations(name, color_hex, sort_order, is_visible, is_active, hourly_rate_minor, created_at_utc, updated_at_utc) VALUES (?, ?, ?, 1, 1, ?, ?, ?)",
    [name, colorHex, order, hourlyRateMinor, now, now],
  );
  const all = await listStations();
  const created = all.find((s) => s.name === name && s.sortOrder === order);
  if (!created) throw new Error("Failed to create station.");
  return created;
}

export interface StationUpdate {
  name: string;
  colorHex: string;
  isVisible: boolean;
  isActive: boolean;
  hourlyRateMinor: number;
}

export async function updateStation(
  id: number,
  u: StationUpdate,
): Promise<Station> {
  if (!validateHourlyRateMinor(u.hourlyRateMinor)) {
    throw new Error("Invalid hourly rate.");
  }
  const db = await getActiveDb();
  await db.execute(
    "UPDATE stations SET name = ?, color_hex = ?, is_visible = ?, is_active = ?, hourly_rate_minor = ?, updated_at_utc = ? WHERE id = ?",
    [
      u.name,
      u.colorHex,
      u.isVisible ? 1 : 0,
      u.isActive ? 1 : 0,
      u.hourlyRateMinor,
      Date.now(),
      id,
    ],
  );
  const s = await getStation(id);
  if (!s) throw new Error("Station not found.");
  return s;
}
