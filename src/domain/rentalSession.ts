/** Pure rental-session guards + station-name validation. No I/O. */
export interface StartGate {
  dayOpen: boolean;
  stationEligible: boolean;
  stationBusy: boolean;
}
export function canStartSessionDetailed(g: StartGate): {
  ok: boolean;
  code: string;
} {
  if (!g.dayOpen) return { ok: false, code: "DAY_CLOSED" };
  if (!g.stationEligible) return { ok: false, code: "STATION_INACTIVE" };
  if (g.stationBusy) return { ok: false, code: "STATION_BUSY" };
  return { ok: true, code: "OK" };
}
export function canStopSession(hasActive: boolean): {
  ok: boolean;
  code: string;
} {
  if (!hasActive) return { ok: false, code: "NO_ACTIVE_SESSION" };
  return { ok: true, code: "OK" };
}
export function validateStationName(raw: string): {
  ok: boolean;
  code: string;
  value: string;
} {
  const value = raw.trim().replace(/\s+/g, " ");
  if (value.length === 0) return { ok: false, code: "NAME_REQUIRED", value };
  if (value.length > 60) return { ok: false, code: "NAME_TOO_LONG", value };
  return { ok: true, code: "OK", value };
}
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export function validateColorHex(raw: string): boolean {
  return HEX_RE.test(raw);
}
