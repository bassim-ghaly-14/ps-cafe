import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { liveHMS, formatHours, formatNumber } from "../utils/format";
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
}: Props) {
  const { t } = useTranslation();
  const timer = startUtc !== null ? liveHMS(startUtc, now) : "00:00:00";
  const canStart = dayOpen && !running && station.isActive;
  return (
    <article
      className={running ? "card run" : "card"}
      style={{ "--c": station.colorHex } as CSSProperties}
      aria-label={station.name}
    >
      <div className="top">
        <h4>{station.name}</h4>
        <span className={running ? "tag on" : "tag"}>
          <span className={running ? "sdot on" : "sdot"} aria-hidden />
          {running ? t("stations.running") : t("stations.idle")}
        </span>
      </div>
      <div className="time" dir="ltr">
        {timer}
      </div>
      <button
        type="button"
        className={running ? "btn stop" : "btn"}
        disabled={running ? busy : !canStart || busy}
        onClick={running ? onStop : onStart}
      >
        {running ? t("stations.stop") : t("stations.start")}
      </button>
      {!dayOpen && !running && (
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
