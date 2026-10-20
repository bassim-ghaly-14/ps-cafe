/**
 * Shared table-sorting primitives.
 *
 * Rules enforced here (and mirrored in SQL):
 * - numbers numerically, timestamps chronologically, text locale-aware.
 * - never sort localized weekday/date display strings for chronological order;
 *   always sort the underlying UTC-millis field.
 * - deterministic tie-breaker (record id) so asc/desc are exact inverses.
 * - null/missing values sort last in both directions (deliberate, consistent).
 */

export type SortDirection = "asc" | "desc";

/** Null/missing always sorts after real values, in both directions. */
export function compareNullableNumber(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: SortDirection,
): number {
  const aMissing = a === null || a === undefined || !Number.isFinite(a);
  const bMissing = b === null || b === undefined || !Number.isFinite(b);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  const d = (a as number) - (b as number);
  return dir === "asc" ? d : -d;
}

export function compareNullableText(
  a: string | null | undefined,
  b: string | null | undefined,
  dir: SortDirection,
  locale = "ar",
): number {
  const aMissing = a === null || a === undefined || a === "";
  const bMissing = b === null || b === undefined || b === "";
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  try {
    const d = (a as string).localeCompare(b as string, locale, {
      numeric: true,
      sensitivity: "base",
    });
    return dir === "asc" ? d : -d;
  } catch {
    const d = String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
    return dir === "asc" ? d : -d;
  }
}

/**
 * Chronological comparator for UTC-millis timestamps.
 * Invalid (non-finite / non-positive) timestamps are treated as missing and
 * sort last. `tieBreaker` (usually the record id) keeps the order
 * deterministic when timestamps are identical.
 */
export function compareTimestamps(
  a: unknown,
  b: unknown,
  dir: SortDirection,
  tieBreaker?: { a: number; b: number },
): number {
  const valid = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && (v as number) > 0;
  const aOk = valid(a);
  const bOk = valid(b);
  if (!aOk && !bOk) return tie(tieBreaker, dir);
  if (!aOk) return 1;
  if (!bOk) return -1;
  const d = (a as number) - (b as number);
  if (d !== 0) return dir === "asc" ? d : -d;
  return tie(tieBreaker, dir);
}

function tie(
  t: { a: number; b: number } | undefined,
  dir: SortDirection,
): number {
  if (!t) return 0;
  const d = t.a - t.b;
  return dir === "asc" ? d : -d;
}

/** Toggle helper: same column flips, new column takes its initial direction. */
export function nextSort<K extends string>(
  current: { key: K; dir: SortDirection } | null,
  clicked: K,
  initialDir: SortDirection,
): { key: K; dir: SortDirection } {
  if (current && current.key === clicked) {
    return { key: clicked, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key: clicked, dir: initialDir };
}
