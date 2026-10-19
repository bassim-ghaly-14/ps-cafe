/** Canonical domain types. All instants are UTC epoch millis. */
export interface BusinessDay {
  id: number;
  startedAtUtc: number;
  endedAtUtc: number | null;
  createdAtUtc: number;
}

export interface Station {
  id: number;
  name: string;
  colorHex: string;
  sortOrder: number;
  isVisible: boolean;
  isActive: boolean;
  createdAtUtc: number;
  updatedAtUtc: number;
}

export interface RentalSession {
  id: number;
  stationId: number;
  businessDayId: number;
  startedAtUtc: number;
  endedAtUtc: number | null;
  durationMs: number | null;
}

export type ActiveTab = "day" | "stations" | "settings";

export function isActiveDay(d: BusinessDay): boolean {
  return d.endedAtUtc === null;
}

export function isActiveSession(s: RentalSession): boolean {
  return s.endedAtUtc === null;
}
