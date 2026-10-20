import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { liveHMS, formatHours, formatNumber } from "../utils/format";
import { formatRatePerHour } from "../utils/format";
import { isReadOnly } from "../mode/visitor";
import type { Station } from "../domain/types";

interface Props {
  station: Station;
  running: boolean;
  startUtc: number | null;
  now: number;
  dayOpen: boolean;
  countToday: number;
  msToday: number;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onOpen: () => void;
}

/** Station card: colored border, status tag, mono timer, emphasis when running. */
export default function StationCard({
  station,
  running,
  startUtc,
  now,
  dayOpen,
  countToday,
  msToday,
  busy,
  onStart,
  onStop,
  onOpen,
}: Props) {
  const { t } = useTranslation();
  const timer = startUtc !== null ? liveHMS(startUtc, now) : "00:00:00";
  const canStart = dayOpen && !running && station.isActive;
  // Visitor mode: the LAN gateway is read-only, so the start/stop control
  // is never offered. The desktop is unaffected.
  const readOnly = isReadOnly();
  return (
    <article
      className={running ? "card run" : "card"}
      style={{ "--c": station.colorHex } as CSSProperties}
      aria-label={station.name}
    >
      <button
        type="button"
        className="card-open"
        onClick={onOpen}
        aria-label={station.name}
      >
        <span className="top">
          <h4>{station.name}</h4>
          <span className={running ? "tag on" : "tag"}>
            <span className={running ? "sdot on" : "sdot"} aria-hidden />
            {running ? t("stations.running") : t("stations.idle")}
          </span>
        </span>
        <span className="time" dir="ltr">
          {timer}
        </span>
        <span className="rate-line">
          {formatRatePerHour(station.hourlyRateMinor)}
        </span>
      </button>
      {!readOnly && (
        <button
          type="button"
          className={running ? "btn stop" : "btn"}
          disabled={running ? busy : !canStart || busy}
          onClick={running ? onStop : onStart}
        >
          {running ? t("stations.stop") : t("stations.start")}
        </button>
      )}
      {!dayOpen && !running && !readOnly && (
        <p className="lock-line">{t("stations.needsOpenDay")}</p>
      )}
      <div className="foot">
        <span>
          {t("stations.timesToday")}: {formatNumber(countToday)}
        </span>
        <span>
          {t("stations.hoursToday")}: {formatHours(msToday)}
        </span>
      </div>
    </article>
  );
}
