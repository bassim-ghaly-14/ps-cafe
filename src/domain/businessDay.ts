/** Pure business-day guards. No I/O, fully unit-testable. */
export function canOpenDay(hasOpenDay: boolean): {
  ok: boolean;
  reason?: string;
} {
  if (hasOpenDay)
    return { ok: false, reason: "A business day is already open." };
  return { ok: true };
}

export function canCloseDay(activeSessionCount: number): {
  ok: boolean;
  reason?: string;
} {
  const n =
    typeof activeSessionCount === "number" &&
    Number.isFinite(activeSessionCount)
      ? Math.max(0, Math.floor(activeSessionCount))
      : 0;
  if (n > 0)
    return {
      ok: false,
      reason: `Cannot close: ${n} station session(s) still active. Stop them first.`,
    };
  return { ok: true };
}

export function canStartSession(
  dayOpen: boolean,
  stationActive: boolean,
): {
  ok: boolean;
  reason?: string;
} {
  if (!dayOpen)
    return { ok: false, reason: "Business day is closed. Open it first." };
  if (stationActive)
    return { ok: false, reason: "Station already has an active session." };
  return { ok: true };
}
