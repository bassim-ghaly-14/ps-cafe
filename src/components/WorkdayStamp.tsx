import { formatWorkdayStamp } from "../utils/format";

interface Props {
  /** Persisted timestamp (UTC ms) of the moment to display. */
  tsUtc: number;
  /** Optional locale override; defaults to Arabic like the rest of the app. */
  locale?: string;
  /** Show the localized weekday beside the date, e.g. "السبت". */
  showWeekday?: boolean;
  className?: string;
}

/**
 * Renders a workday date/time with explicit bidi isolation.
 *
 * The date and the clock are separate LTR isolates so the browser cannot
 * reorder the numeric date (17/10/2026 -> 2026/10/17) or pull the Arabic
 * meridiem into the middle of the timestamp. The meridiem itself stays in
 * the surrounding RTL flow so it reads naturally in Arabic.
 */
export default function WorkdayStampView({
  tsUtc,
  locale = "ar",
  showWeekday = false,
  className,
}: Props) {
  const { weekday, date, time, dayPeriod, weekdaySeparator, timeSeparator } =
    formatWorkdayStamp(tsUtc, locale);
  return (
    <span className={className}>
      {showWeekday && weekday ? (
        <>
          <span className="stamp-weekday">{weekday}</span>
          <span aria-hidden="true">{weekdaySeparator}</span>
        </>
      ) : null}
      <span className="stamp-date" dir="ltr">
        {date}
      </span>
      {time ? (
        <>
          <span aria-hidden="true">{timeSeparator}</span>
          <span className="stamp-time" dir="ltr">
            {time}
          </span>
          {dayPeriod ? (
            <>
              {" "}
              <span className="stamp-dayperiod">{dayPeriod}</span>
            </>
          ) : null}
        </>
      ) : null}
    </span>
  );
}
