/** Elapsed time: always now - startUtc. Display layer only refreshes. */
export function elapsedMs(
  startedAtUtc: number,
  nowUtc: number = Date.now(),
): number {
  if (!isValidTimestamp(startedAtUtc) || !isValidTimestamp(nowUtc)) return 0;
  const d = nowUtc - startedAtUtc;
  return d < 0 ? 0 : d; // clamp backward clock jumps; never negative
}

/**
 * A persisted timestamp is valid when it is a finite, positive UTC-millis
 * number. Non-finite values (NaN, Infinity), zero/negative values, or
 * non-numbers indicate corrupted storage and must never drive a timer.
 */
export function isValidTimestamp(ts: unknown): ts is number {
  return typeof ts === "number" && Number.isFinite(ts) && ts > 0;
}

/**
 * Clock-jump policy (documented limitation): elapsed time derives from the
 * wall clock (`Date.now()`). If the OS clock moves backwards while the app
 * is closed, `now < start` and the display clamps to 00:00:00 rather than
 * showing a negative duration or rewriting history. Forward jumps show a
 * larger elapsed value honestly. No monotonic-clock guarantee is claimed.
 */
export function clockJumpInfo(
  startedAtUtc: number,
  nowUtc: number,
): "ok" | "clamped-backward" | "invalid" {
  if (!isValidTimestamp(startedAtUtc) || !isValidTimestamp(nowUtc))
    return "invalid";
  return nowUtc < startedAtUtc ? "clamped-backward" : "ok";
}

export function finalizeDurationMs(
  startedAtUtc: number,
  endedAtUtc: number,
): number {
  if (endedAtUtc < startedAtUtc)
    throw new Error("End timestamp precedes start timestamp.");
  return endedAtUtc - startedAtUtc;
}

function p2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format ms as HH:MM:SS (hours unbounded, e.g. 25:01:00). */
export function formatHMS(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}`;
}

export function formatLocal(tsUtc: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(tsUtc));
}

export function msToHours(ms: number): number {
  return ms / 3_600_000;
}
