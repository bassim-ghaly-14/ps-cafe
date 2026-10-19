import { elapsedMs, formatHMS } from "./time";
export function formatDateTimeLocal(tsUtc: number, locale = "ar"): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(tsUtc));
  } catch {
    return new Date(tsUtc).toLocaleString();
  }
}
export function formatNumber(n: number, locale = "ar"): string {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
      n,
    );
  } catch {
    return String(n);
  }
}
export function formatHours(ms: number, locale = "ar"): string {
  const h = ms / 3600000;
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(h);
  } catch {
    return h.toFixed(1);
  }
}
export function liveHMS(
  startedAtUtc: number,
  nowUtc: number = Date.now(),
): string {
  return formatHMS(elapsedMs(startedAtUtc, nowUtc));
}
