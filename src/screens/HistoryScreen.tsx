import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  compareTimestamps,
  compareNullableNumber,
  nextSortCycle,
  type SortDirection,
} from "../utils/sort";
import {
  formatDateTimeLocal,
  formatHours,
  formatNumber,
  formatRevenue,
  liveHMS,
} from "../utils/format";
import { isValidTimestamp, formatHMS } from "../utils/time";
import { useNow } from "../hooks/useNow";
import WorkdayStamp from "../components/WorkdayStamp";
import BackButton from "../components/BackButton";
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

type HistorySortKey =
  | "id"
  | "startedAt"
  | "endedAt"
  | "duration"
  | "sessions"
  | "hours"
  | "revenue";

// `null` = unsorted = genuine default (server order: newest-first from
// businessDayRepo.listDays). Cycle per column: null -> asc -> desc -> null
// via nextSortCycle, so a third click restores the server default.

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
  // null = unsorted = genuine default (source order, newest-first from
  // businessDayRepo.listDays). Cycle per column: null -> asc -> desc -> null.
  const [sort, setSort] = useState<{
    key: HistorySortKey;
    dir: SortDirection;
  } | null>(null);

  const sortedDays = useMemo(() => {
    if (!sort) return [...days];
    return [...days].sort((a, b) => {
      switch (sort.key) {
        case "id":
          return compareNullableNumber(a.id, b.id, sort.dir);
        case "startedAt":
          return compareTimestamps(a.startedAtUtc, b.startedAtUtc, sort.dir, {
            a: a.id,
            b: b.id,
          });
        case "endedAt": {
          const av = a.endedAtUtc ?? null;
          const bv = b.endedAtUtc ?? null;
          return compareTimestamps(av, bv, sort.dir, { a: a.id, b: b.id });
        }
        case "duration": {
          const aggA = dayAggregates.get(a.id);
          const aggB = dayAggregates.get(b.id);
          return compareNullableNumber(
            aggA?.totalMs ?? null,
            aggB?.totalMs ?? null,
            sort.dir,
          );
        }
        case "sessions": {
          const aggA = dayAggregates.get(a.id);
          const aggB = dayAggregates.get(b.id);
          return compareNullableNumber(
            aggA?.count ?? null,
            aggB?.count ?? null,
            sort.dir,
          );
        }
        case "hours": {
          const aggA = dayAggregates.get(a.id);
          const aggB = dayAggregates.get(b.id);
          return compareNullableNumber(
            aggA?.totalMs ?? null,
            aggB?.totalMs ?? null,
            sort.dir,
          );
        }
        case "revenue": {
          const aggA = dayAggregates.get(a.id);
          const aggB = dayAggregates.get(b.id);
          return compareNullableNumber(
            aggA?.revenueMinor ?? null,
            aggB?.revenueMinor ?? null,
            sort.dir,
          );
        }
        default:
          return 0;
      }
    });
  }, [days, sort, dayAggregates]);

  return (
    <section aria-label={t("day.historyTitle")}>
      <BackButton onClick={onBack} labelKey="day.backToDay" />
      <h3>{t("day.historyTitle")}</h3>
      {days.length === 0 ? (
        <p className="sub">{t("day.emptyHistory")}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th aria-sort={ariaSort("id", sort)}>
                  <SortHeader
                    columnKey="id"
                    label={t("day.colDay")}
                    sort={sort}
                    onSort={setSort}
                    initialDir="asc"
                  />
                </th>
                <th aria-sort={ariaSort("startedAt", sort)}>
                  <SortHeader
                    columnKey="startedAt"
                    label={t("day.colOpened")}
                    sort={sort}
                    onSort={setSort}
                    initialDir="asc"
                  />
                </th>
                <th aria-sort={ariaSort("endedAt", sort)}>
                  <SortHeader
                    columnKey="endedAt"
                    label={t("day.colClosed")}
                    sort={sort}
                    onSort={setSort}
                    initialDir="asc"
                  />
                </th>
                <th
                  className="n"
                  dir="ltr"
                  aria-sort={ariaSort("duration", sort)}
                >
                  <SortHeader
                    columnKey="duration"
                    label={t("day.colDuration")}
                    sort={sort}
                    onSort={setSort}
                    initialDir="asc"
                  />
                </th>
                <th
                  className="n"
                  dir="ltr"
                  aria-sort={ariaSort("sessions", sort)}
                >
                  <SortHeader
                    columnKey="sessions"
                    label={t("day.colSessions")}
                    sort={sort}
                    onSort={setSort}
                    initialDir="asc"
                  />
                </th>
                <th className="n" dir="ltr" aria-sort={ariaSort("hours", sort)}>
                  <SortHeader
                    columnKey="hours"
                    label={t("day.colHours")}
                    sort={sort}
                    onSort={setSort}
                    initialDir="asc"
                  />
                </th>
                <th className="n" aria-sort={ariaSort("revenue", sort)}>
                  <SortHeader
                    columnKey="revenue"
                    label={t("day.colRevenue")}
                    sort={sort}
                    onSort={setSort}
                    initialDir="asc"
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedDays.map((d) => {
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

function ariaSort(
  columnKey: HistorySortKey,
  sort: { key: HistorySortKey; dir: SortDirection } | null,
): "ascending" | "descending" | "none" {
  if (sort?.key !== columnKey) return "none";
  return sort.dir === "asc" ? "ascending" : "descending";
}

// NOTE: the sortable-column prop is named `columnKey` (not `key`): React
// strips `key` before it reaches the component, which is the regression
// that made every header click a no-op (key arrived as undefined).
function SortHeader({
  columnKey,
  label,
  sort,
  onSort,
  initialDir,
}: {
  columnKey: HistorySortKey;
  label: string;
  sort: { key: HistorySortKey; dir: SortDirection } | null;
  onSort: (s: { key: HistorySortKey; dir: SortDirection } | null) => void;
  initialDir: SortDirection;
}) {
  const active = sort?.key === columnKey;
  const dir = active ? sort.dir : null;
  return (
    <button
      type="button"
      className="sort-header"
      onClick={() => onSort(nextSortCycle(sort, columnKey, initialDir))}
      aria-label={`${label} ${active ? (dir === "asc" ? "sorted ascending" : "sorted descending") : "sortable"}`}
    >
      <span className="sort-label">{label}</span>
      {active ? (
        dir === "asc" ? (
          <ArrowUp size={14} aria-hidden />
        ) : (
          <ArrowDown size={14} aria-hidden />
        )
      ) : (
        <ArrowDown size={14} className="sort-inactive" aria-hidden />
      )}
    </button>
  );
}
