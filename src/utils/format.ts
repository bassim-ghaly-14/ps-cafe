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

/** Strip Unicode bidi control marks that Intl inserts into Arabic output. */
function stripBidiMarks(s: string): string {
  return s.replace(/[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g, "");
}

/**
 * Structured workday stamp, e.g. for "السبت — 17/10/2026، 8:34 م".
 *
 * The date and the clock are returned separately (and free of bidi marks) so
 * the UI can render each in an explicitly LTR isolate. Emitting one combined
 * string makes the browser reorder the numeric date (17/10/2026 -> 2026/10/17)
 * and lets the Arabic meridiem jump into the middle of the timestamp.
 */
export interface WorkdayStamp {
  /** Localized weekday, e.g. "السبت". */
  weekday: string;
  /** Localized date without bidi marks, e.g. "17/10/2026". */
  date: string;
  /** Localized clock without bidi marks, e.g. "8:34". */
  time: string;
  /** Meridiem/period marker, e.g. "م" (Arabic) or "PM" (Latin). Empty if none. */
  dayPeriod: string;
  /** Separator between the weekday and the date, e.g. " — ". */
  weekdaySeparator: string;
  /** Separator between the date and the clock, e.g. "، " (Arabic) / ", ". */
  timeSeparator: string;
}

/**
 * Builds a structured workday stamp from a single persisted timestamp so the
 * weekday can never drift from the date.
 */
export function formatWorkdayStamp(tsUtc: number, locale = "ar"): WorkdayStamp {
  const date = new Date(tsUtc);
  try {
    const weekday = stripBidiMarks(
      new Intl.DateTimeFormat(locale, { weekday: "long" }).format(date),
    );
    const parts = new Intl.DateTimeFormat(locale, {
      timeStyle: "short",
    }).formatToParts(date);
    const time = stripBidiMarks(
      parts
        .filter((p) => p.type === "hour" || p.type === "minute")
        .map((p) => p.value)
        .join(":"),
    );
    const dayPeriod = stripBidiMarks(
      parts.find((p) => p.type === "dayPeriod")?.value ?? "",
    );
    const dateText = stripBidiMarks(
      new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date),
    );
    const isRtl = locale.startsWith("ar");
    return {
      weekday,
      date: dateText,
      time,
      dayPeriod,
      weekdaySeparator: " — ",
      timeSeparator: isRtl ? "، " : ", ",
    };
  } catch {
    const fallback = new Date(tsUtc).toLocaleString();
    return {
      weekday: "",
      date: fallback,
      time: "",
      dayPeriod: "",
      weekdaySeparator: " — ",
      timeSeparator: ", ",
    };
  }
}

/**
 * Workday opening label: localized weekday beside the date/time, e.g.
 * "السبت — 17/10/2026، 8:34 م". Both parts are rendered from the same
 * persisted timestamp so the weekday can never drift from the date.
 */
export function formatWeekdayDateTime(tsUtc: number, locale = "ar"): string {
  const { weekday, date, time, dayPeriod, weekdaySeparator, timeSeparator } =
    formatWorkdayStamp(tsUtc, locale);
  if (!weekday) return date;
  const when = dayPeriod
    ? `${date}${timeSeparator}${time} ${dayPeriod}`
    : `${date}${timeSeparator}${time}`;
  return `${weekday}${weekdaySeparator}${when}`;
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
