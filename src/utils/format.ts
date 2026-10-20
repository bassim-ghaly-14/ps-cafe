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

/**
 * Minor-unit (piasters) revenue as locale-aware EGP, e.g. 2500 -> 25 EGP.
 * Keeps exact integer input; Intl handles grouping + currency display.
 */
export function formatRevenue(minor: number, locale = "ar"): string {
  const v = Number.isFinite(minor) ? Math.round(minor) / 100 : 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "EGP",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `${(Math.round(v * 100) / 100).toFixed(2)} EGP`;
  }
}

/**
 * Workday opening label: localized weekday beside the date/time, e.g.
 * "السبت — 17/10/2026، 8:34 م". Both parts are rendered from the same
 * persisted timestamp so the weekday can never drift from the date.
 */
export function formatWeekdayDateTime(tsUtc: number, locale = "ar"): string {
  const date = new Date(tsUtc);
  try {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "long" }).format(
      date,
    );
    const when = new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
    return `${weekday} — ${when}`;
  } catch {
    return new Date(tsUtc).toLocaleString();
  }
}

/** Hourly rate for labels, e.g. 2500 -> "25 / hour" localized. */
export function formatRatePerHour(minor: number, locale = "ar"): string {
  const v = Number.isFinite(minor) && minor >= 0 ? Math.round(minor) / 100 : 0;
  try {
    const amount = new Intl.NumberFormat(locale, {
      minimumFractionDigits: v % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(v);
    const unit = locale === "ar" ? "جنيه/ساعة" : "EGP/hour";
    return `${amount} ${unit}`;
  } catch {
    return `${v} EGP/hour`;
  }
}
