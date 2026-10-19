import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import StatCard from "../components/StatCard";
import ConfirmDialog from "../components/ConfirmDialog";
import { useNow } from "../hooks/useNow";
import type { CafeResult } from "../hooks/useCafe";
import type { BusinessDay, RentalSession, Station } from "../domain/types";
import {
  formatDateTimeLocal,
  formatHours,
  formatNumber,
  liveHMS,
} from "../utils/format";

interface Props {
  openDay: BusinessDay | null;
  days: BusinessDay[];
  stations: Station[];
  activeSessions: RentalSession[];
  closedDaysCount: number;
  allTime: { count: number; totalMs: number };
  dayAgg: { count: number; totalMs: number };
  busy: boolean;
  notice: { kind: "ok" | "err"; text: string } | null;
  onOpen: () => Promise<CafeResult>;
  onClose: () => Promise<CafeResult>;
  setNotice: (n: { kind: "ok" | "err"; text: string } | null) => void;
}

/** Business-day screen: status, live clock, 4 stat cards, history table. */
export default function BusinessDayScreen(props: Props) {
  const { openDay, days, stations, activeSessions } = props;
  const { closedDaysCount, allTime, dayAgg, busy, notice } = props;
  const { onOpen, onClose, setNotice } = props;
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [blocked, setBlocked] = useState<string[] | null>(null);
  const now = useNow(openDay !== null);
  const nameById = useMemo(
    () => new Map(stations.map((s) => [s.id, s.name])),
    [stations],
  );
  const dayClock = openDay ? liveHMS(openDay.startedAtUtc, now) : "00:00:00";

  const handleMain = async () => {
    if (busy) return;
    if (!openDay) {
      const r = await onOpen();
      setNotice({
        kind: r.ok ? "ok" : "err",
        text: t(r.messageKey, r.params as Record<string, string>),
      });
      return;
    }
    setConfirming(true);
  };

  const handleConfirmClose = async () => {
    setConfirming(false);
    const r = await onClose();
    if (r.messageKey === "BLOCKED") {
      setBlocked(
        activeSessions.map(
          (a) => nameById.get(a.stationId) ?? `#${a.stationId}`,
        ),
      );
      return;
    }
    setNotice({
      kind: r.ok ? "ok" : "err",
      text: t(r.messageKey, r.params as Record<string, string>),
    });
  };

  return (
    <section aria-label={t("nav.day")}>
      {notice && (
        <p
          className={notice.kind === "ok" ? "notice ok" : "notice err"}
          role="status"
        >
          {notice.text}
        </p>
      )}
      {blocked && (
        <div className="box warn" role="alert">
          <h3>{t("day.closeBlockedTitle")}</h3>
          <p className="sub">
            {blocked.length === 1
              ? t("day.closeBlockedBodyOne")
              : t("day.closeBlockedBody", {
                  count: formatNumber(blocked.length),
                })}
          </p>
          <ul className="blocked-list">
            {blocked.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setBlocked(null)}
          >
            {t("common.close")}
          </button>
        </div>
      )}
      <div className="box">
        <div className="day-ctl">
          <div>
            <div className="clock" dir="ltr">
              {dayClock}
            </div>
            <div className="sub">
              {openDay ? t("day.closeHint") : t("day.openHint")}
            </div>
            {openDay && (
              <div className="sub">
                {t("day.startedAt")}:{" "}
                {formatDateTimeLocal(openDay.startedAtUtc)}
              </div>
            )}
          </div>
          <button
            type="button"
            className={openDay ? "btn stop" : "btn"}
            disabled={busy}
            onClick={handleMain}
          >
            {openDay ? t("day.close") : t("day.start")}
          </button>
        </div>
      </div>
      <div className="grid stats">
        <StatCard
          label={t("stats.closedDays")}
          value={formatNumber(closedDaysCount)}
        />
        <StatCard
          label={t("stats.totalSessions")}
          value={formatNumber(allTime.count)}
        />
        <StatCard
          label={t("stats.totalHours")}
          value={formatHours(allTime.totalMs)}
        />
        <StatCard
          label={t("stats.todaySessions")}
          value={openDay ? formatNumber(dayAgg.count) : formatNumber(0)}
        />
      </div>
      <div className="box">
        <h3>{t("day.historyTitle")}</h3>
        {days.length === 0 ? (
          <p className="sub">{t("day.emptyHistory")}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("day.colDay")}</th>
                  <th>{t("day.colOpened")}</th>
                  <th>{t("day.colClosed")}</th>
                  <th>{t("day.colDuration")}</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr
                    key={d.id}
                    className={d.endedAtUtc === null ? "row-open" : undefined}
                  >
                    <td>#{d.id}</td>
                    <td>
                      {d.endedAtUtc === null && d.id === openDay?.id
                        ? t("day.currentRow")
                        : formatDateTimeLocal(d.startedAtUtc)}
                    </td>
                    <td>
                      {d.endedAtUtc === null
                        ? t("day.notClosed")
                        : formatDateTimeLocal(d.endedAtUtc)}
                    </td>
                    <td className="n" dir="ltr">
                      {liveHMS(d.startedAtUtc, d.endedAtUtc ?? now)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {confirming && (
        <ConfirmDialog
          title={t("day.confirmCloseTitle")}
          body={t("day.confirmCloseBody")}
          confirmLabel={t("day.confirm")}
          cancelLabel={t("day.cancel")}
          onConfirm={handleConfirmClose}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  );
}
