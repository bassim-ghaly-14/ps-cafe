/**
 * Per-device hourly pricing + proportional revenue (pure, no I/O).
 *
 * Billing contract (minimal, documented — the app had no billing before):
 * - Rate is stored as an INTEGER in minor currency units (piasters, EGP).
 * - Revenue is strictly proportional to elapsed time, billed to the second:
 *     revenue = round(duration_ms * rate_minor_per_hour / 3_600_000)
 * - No minimum charge, no grace period, no rounding-up of partial hours,
 *   no discounts, no taxes. Revenue = amount attributable at the recorded
 *   rate, not a collected-payment record.
 * - A running session is billed at its start-time snapshot; changing the
 *   device rate mid-session never affects the active session.
 */
export const RATE_MINOR_PER_MAJOR = 100;
export const RATE_CURRENCY = "EGP";
/** Upper bound: 10,000 EGP/hour. Guards against typo-scale values. */
export const MAX_RATE_MINOR = 1_000_000;

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Normalizes user input: Arabic-Indic digits + Arabic decimal separator. */
export function normalizeRateInput(raw: string): string {
  let out = "";
  for (const ch of raw.trim()) {
    const idx = ARABIC_DIGITS.indexOf(ch);
    if (idx >= 0) out += String(idx);
    else if (ch === "٫" || ch === "،") out += ".";
    else if (ch === ",") out += ".";
    else out += ch;
  }
  return out.trim();
}

export interface RateParseResult {
  ok: boolean;
  code: string;
  minor: number;
}

/**
 * Parses a major-unit (EGP) amount string into integer minor units.
 * Empty input is REJECTED (never silently becomes 0); the user must type 0.
 */
export function parseHourlyRateInput(raw: string): RateParseResult {
  const s = normalizeRateInput(raw).replace(/\s+/g, "");
  if (s.length === 0) return { ok: false, code: "RATE_REQUIRED", minor: 0 };
  if (!/^\d+(\.\d{1,2})?$/.test(s))
    return { ok: false, code: "RATE_INVALID", minor: 0 };
  const major = Number(s);
  if (!Number.isFinite(major))
    return { ok: false, code: "RATE_INVALID", minor: 0 };
  const minor = Math.round(major * RATE_MINOR_PER_MAJOR);
  if (!validateHourlyRateMinor(minor))
    return { ok: false, code: "RATE_OUT_OF_RANGE", minor: 0 };
  return { ok: true, code: "OK", minor };
}

export function validateHourlyRateMinor(minor: unknown): minor is number {
  return (
    typeof minor === "number" &&
    Number.isInteger(minor) &&
    minor >= 0 &&
    minor <= MAX_RATE_MINOR
  );
}

/** Major-unit string suitable for prefilling the edit field (e.g. 25 or 25.5). */
export function formatRateMajor(minor: number): string {
  if (!validateHourlyRateMinor(minor)) return "0";
  const v = minor / RATE_MINOR_PER_MAJOR;
  return String(Math.round(v * 100) / 100);
}

/**
 * Revenue for one session in minor units, or null when no reliable rate
 * exists (legacy NULL snapshot) or inputs are invalid. Never fabricates.
 */
export function sessionRevenueMinor(
  durationMs: number | null,
  rateMinorPerHour: number | null,
): number | null {
  if (rateMinorPerHour === null || rateMinorPerHour === undefined) return null;
  if (!validateHourlyRateMinor(rateMinorPerHour)) return null;
  if (
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  )
    return null;
  // duration_ms (<= ~1e9 for realistic sessions) * rate (<= 1e6) stays
  // well below Number.MAX_SAFE_INTEGER, so integer rounding is exact.
  return Math.round((durationMs * rateMinorPerHour) / 3_600_000);
}
