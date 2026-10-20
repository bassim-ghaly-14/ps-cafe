import { useTranslation } from "react-i18next";
import { useNow } from "../hooks/useNow";
import { isValidTimestamp, formatHMS } from "../utils/time";
import {
  formatDateTimeLocal,
  formatHours,
  formatNumber,
  formatRevenue,
  liveHMS,
} from "../utils/format";
import WorkdayStamp from "../components/WorkdayStamp";
import type { BusinessDay } from "../domain/types";

interface DayAggregate {
  count: number;
  totalMs: number;
  revenueMinor: number;
}

interface Props {
  openDay: BusinessDay | null;
  days: BusinessDay[];
  dayAggregates: Map<number, DayAggregate>;
  onBack: () => void;
}

/**
 * Full workday history page. Every metric is scoped to its own workday id
 * from a single aggregate query — never the currently active workday's
 * totals, and never lifetime aggregates.
 */
export default function HistoryScreen({
  openDay,
  days,
  dayAggregates,
  onBack,
}: Props) {
  const { t } = useTranslation();
  const now = useNow(openDay !== null);

  return (
    <section aria-label={t("day.historyTitle")}>
      <button type="button" className="btn ghost" onClick={onBack}>
        {t("day.backToDay")}
      </button>
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
                <th>{t("day.colSessions")}</th>
                <th>{t("day.colHours")}</th>
                <th>{t("day.colRevenue")}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const isOpen = d.endedAtUtc === null;
                const current = isOpen && d.id === openDay?.id;
                const agg = dayAggregates.get(d.id);
                const count = agg?.count ?? 0;
                const totalMs = agg?.totalMs ?? 0;
                const revenue = agg?.revenueMinor ?? 0;
                const startedValid = isValidTimestamp(d.startedAtUtc);
                const endedValid = isValidTimestamp(d.endedAtUtc);
                const startedAt = startedValid ? d.startedAtUtc : 0;
                const endedAt = endedValid ? (d.endedAtUtc ?? 0) : 0;

                return (
                  <tr key={d.id} className={current ? "row-open" : undefined}>
                    <td>#{d.id}</td>
                    <td>
                      {current ? (
                        t("day.currentRow")
                      ) : startedValid ? (
                        <WorkdayStamp tsUtc={startedAt} showWeekday />
                      ) : (
                        t("common.dash")
                      )}
                    </td>
                    <td>
                      {isOpen
                        ? t("day.notClosed")
                        : endedValid
                          ? formatDateTimeLocal(endedAt)
                          : t("common.dash")}
                    </td>
                    <td className="n" dir="ltr">
                      {current
                        ? liveHMS(d.startedAtUtc, now)
                        : formatHMS(totalMs)}
                    </td>
                    <td className="n" dir="ltr">
                      {formatNumber(count)}
                    </td>
                    <td className="n" dir="ltr">
                      {totalMs > 0 ? formatHours(totalMs) : t("common.dash")}
                    </td>
                    <td className="n">{formatRevenue(revenue)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
