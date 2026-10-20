import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import StatCard from "../components/StatCard";
import ConfirmDialog from "../components/ConfirmDialog";
import WorkdayStamp from "../components/WorkdayStamp";
import { useNow } from "../hooks/useNow";
import { isReadOnly } from "../mode/visitor";
import type { CafeResult } from "../hooks/useCafe";
import type { BusinessDay, RentalSession, Station } from "../domain/types";
import type { DayAggregate } from "../repositories/sessionRepo";
import {
  formatHours,
  formatNumber,
  formatRevenue,
  liveHMS,
} from "../utils/format";

interface Props {
  openDay: BusinessDay | null;
  stations: Station[];
  activeSessions: RentalSession[];
  dayAgg: DayAggregate;
  busy: boolean;
  notice: { kind: "ok" | "err"; text: string } | null;
  onOpen: () => Promise<CafeResult>;
  onClose: () => Promise<CafeResult>;
  setNotice: (n: { kind: "ok" | "err"; text: string } | null) => void;
  onViewHistory: () => void;
}

/**
 * Business-day screen: the currently active workday only.
 * Status + live clock, opening timestamp, and stat cards scoped to the
 * open day. Full history lives on its own page (سجل أيام العمل).
 */
export default function BusinessDayScreen(props: Props) {
  const { openDay, stations, activeSessions } = props;
  const { dayAgg, busy, notice } = props;
  const { onOpen, onClose, setNotice, onViewHistory } = props;
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [blocked, setBlocked] = useState<string[] | null>(null);
  const now = useNow(openDay !== null);
  const nameById = useMemo(
    () => new Map(stations.map((s) => [s.id, s.name])),
    [stations],
  );
  const dayClock = openDay ? liveHMS(openDay.startedAtUtc, now) : "00:00:00";
  // Visitor mode is read-only: the business day can be observed but not
  // opened or closed from a phone.
  const readOnly = isReadOnly();

  const handleMain = async () => {
    if (busy || readOnly) return;
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
          <div className="day-status">
            <div className="clock" dir="ltr">
              {dayClock}
            </div>
            {openDay && (
              <div className="opened">
                <span className="opened-label">{t("day.startedAt")}:</span>
                <span className="opened-at">
                  <WorkdayStamp tsUtc={openDay.startedAtUtc} />
                </span>
              </div>
            )}
            <div className="sub">
              {openDay ? t("day.closeHint") : t("day.openHint")}
            </div>
          </div>
          {!readOnly && (
            <button
              type="button"
              className={openDay ? "btn stop" : "btn"}
              disabled={busy}
              onClick={handleMain}
            >
              {openDay ? t("day.close") : t("day.start")}
            </button>
          )}
        </div>
      </div>
      <div className="grid stats">
        <StatCard
          label={t("stats.todaySessions")}
          value={formatNumber(dayAgg.count)}
        />
        <StatCard
          label={t("stats.todayHours")}
          value={formatHours(dayAgg.totalMs)}
        />
        <StatCard
          label={t("stats.todayRevenue")}
          value={formatRevenue(dayAgg.revenueMinor)}
          className="revenue"
        />
      </div>
      <button
        type="button"
        className="btn"
        style={{ width: "100%" }}
        disabled={busy}
        onClick={onViewHistory}
      >
        {t("day.historyTitle")}
      </button>
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
