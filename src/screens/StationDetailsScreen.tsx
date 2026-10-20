import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp } from "lucide-react";
import StatCard from "../components/StatCard";
import { useNow } from "../hooks/useNow";
import { formatRateMajor, sessionRevenueMinor } from "../domain/pricing";
import { elapsedMs, formatHMS } from "../utils/time";
import { nextSort, type SortDirection } from "../utils/sort";
import {
  formatDateTimeLocal,
  formatHours,
  formatNumber,
  formatRatePerHour,
  formatRevenue,
  liveHMS,
} from "../utils/format";
import { getStation } from "../repositories/stationRepo";
import {
  aggregateForStation,
  getActiveSession,
  listSessionsForStation,
} from "../repositories/sessionRepo";
import BackButton from "../components/BackButton";
import type { CafeResult } from "../hooks/useCafe";
import type { BusinessDay, RentalSession, Station } from "../domain/types";

interface Props {
  stationId: number;
  openDay: BusinessDay | null;
  onBack: () => void;
  onStart: (id: number) => Promise<CafeResult>;
  onStop: (id: number) => Promise<CafeResult>;
  setNotice: (n: { kind: "ok" | "err"; text: string } | null) => void;
}

const PAGE_SIZE = 20;

type LoadState =
  | { kind: "loading" }
  | { kind: "missing" }
  | {
      kind: "ready";
      station: Station;
      active: RentalSession | null;
      count: number;
      totalMs: number;
      revenueMinor: number;
      pricedCount: number;
      history: RentalSession[];
      total: number;
    };

function shownCount(s: LoadState): number {
  if (s.kind === "ready") return Math.max(PAGE_SIZE, s.history.length);
  return PAGE_SIZE;
}

/**
 * Dedicated full-page device details: identity + live state, KPI cards,
 * today's activity, and paginated newest-first session history.
 * Revenue always uses each session's own rate snapshot so price edits
 * can't rewrite history.
 */
export default function StationDetailsScreen(props: Props) {
  const { stationId, openDay, onBack, onStart, onStop, setNotice } = props;
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const now = useNow(true);
  const [sort, setSort] = useState<{
    key: "startedAt" | "endedAt" | "duration" | "rate";
    dir: SortDirection;
  } | null>({
    key: "startedAt",
    dir: "desc",
  });

  const load = async (id: number, limit: number) => {
    try {
      const station = await getStation(id);
      if (!station) {
        setState({ kind: "missing" });
        return;
      }
      const [active, agg, page] = await Promise.all([
        getActiveSession(id),
        aggregateForStation(id),
        listSessionsForStation(
          id,
          limit,
          0,
          sort?.key ?? "startedAt",
          sort?.dir ?? "desc",
        ),
      ]);
      setState({
        kind: "ready",
        station,
        active,
        count: agg.count,
        totalMs: agg.totalMs,
        revenueMinor: agg.revenueMinor,
        pricedCount: agg.pricedCount,
        history: page.rows,
        total: page.total,
      });
    } catch {
      setState({ kind: "missing" });
    }
  };

  useEffect(() => {
    setState({ kind: "loading" });
    void load(stationId, PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId]);

  useEffect(() => {
    void load(stationId, PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort]);

  const refresh = () => load(stationId, shownCount(state));

  if (state.kind === "loading") {
    return (
      <section aria-label={t("device.back")}>
        <p className="sub" role="status">
          {t("device.loading")}
        </p>
      </section>
    );
  }

  if (state.kind === "missing") {
    return (
      <section aria-label={t("device.back")}>
        <BackButton onClick={onBack} labelKey="device.back" />
        <div className="box" style={{ marginTop: 16 }} role="alert">
          <h3>{t("device.notFoundTitle")}</h3>
          <p className="sub">{t("device.notFoundBody")}</p>
        </div>
      </section>
    );
  }

  const { station, active } = state;
  const running = active !== null;
  const statusKey = running
    ? "device.statusRunning"
    : !station.isActive
      ? "device.statusInactive"
      : !station.isVisible
        ? "device.statusHidden"
        : "device.statusIdle";

  const avgMs = state.count > 0 ? Math.round(state.totalMs / state.count) : 0;
  const remaining = state.total - state.history.length;

  const todaySessions = state.history.filter(
    (s) => openDay !== null && s.businessDayId === openDay.id,
  );
  let todayMs = 0;
  let todayRevenue = 0;
  for (const s of todaySessions) {
    if (s.endedAtUtc === null || s.durationMs === null) continue;
    todayMs += s.durationMs;
    const rev = sessionRevenueMinor(s.durationMs, s.rateMinorAtStart);
    if (rev !== null) todayRevenue += rev;
  }
  const lastCompleted = state.history.find(
    (s) => s.endedAtUtc !== null && s.durationMs !== null,
  );

  const act = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = running ? await onStop(station.id) : await onStart(station.id);
      const params = r.params as Record<string, string> | undefined;
      setNotice({ kind: r.ok ? "ok" : "err", text: t(r.messageKey, params) });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const more = async () => {
    try {
      const page = await listSessionsForStation(
        stationId,
        PAGE_SIZE,
        state.history.length,
        sort?.key ?? "startedAt",
        sort?.dir ?? "desc",
      );
      setState({
        ...state,
        station: (await getStation(stationId)) ?? state.station,
        history: [...state.history, ...page.rows],
        total: page.total,
      });
    } catch {
      /* keep current page on failure */
    }
  };

  const liveRev =
    running && active
      ? sessionRevenueMinor(
          elapsedMs(active.startedAtUtc, now),
          active.rateMinorAtStart,
        )
      : null;

  return (
    <section aria-label={station.name}>
      <BackButton onClick={onBack} labelKey="device.back" />
      <div className="box dev-head" style={{ marginTop: 16 }}>
        <div className="dev-title-row">
          <span
            className="sw"
            style={{ background: station.colorHex }}
            aria-hidden
          />
          <h2 className="dev-name">{station.name}</h2>
          <span className={running ? "tag on" : "tag"} role="status">
            <span className={running ? "sdot on" : "sdot"} aria-hidden />
            {t(statusKey)}
          </span>
        </div>
        <div className="dev-meta">
          <span className="dev-rate">
            {t("device.rateLabel")}:{" "}
            {station.hourlyRateMinor > 0 ? (
              <b className="n" dir="ltr">
                {formatRateMajor(station.hourlyRateMinor)} EGP
              </b>
            ) : (
              <span className="sub">{t("device.unpriced")}</span>
            )}
            <span className="sub">
              {" "}
              · {formatRatePerHour(station.hourlyRateMinor)}
            </span>
          </span>
          {running && active && (
            <span className="sub">
              {t("device.startedAt")}:{" "}
              {formatDateTimeLocal(active.startedAtUtc)} ·{" "}
              {t("device.elapsedNow")}:{" "}
              <b className="n" dir="ltr">
                {liveHMS(active.startedAtUtc, now)}
              </b>
              {liveRev !== null && (
                <>
                  {" "}
                  · {t("device.liveRevenue")}:{" "}
                  <b className="n">{formatRevenue(liveRev)}</b>
                </>
              )}
            </span>
          )}
        </div>
        <div className="row2">
          <button
            type="button"
            className={running ? "btn stop" : "btn"}
            disabled={
              busy || (!running && (openDay === null || !station.isActive))
            }
            onClick={act}
          >
            {running ? t("device.stop") : t("device.start")}
          </button>
        </div>
      </div>
      <div className="grid stats">
        <div className="stat revenue">
          <span>{t("device.kpiRevenue")}</span>
          <b className="n">{formatRevenue(state.revenueMinor)}</b>
          <small className="sub">
            {state.pricedCount > 0
              ? t("device.kpiRevenueHint", {
                  count: formatNumber(state.pricedCount),
                })
              : t("device.kpiRevenueNoPriced")}
          </small>
        </div>
        <StatCard
          label={t("device.kpiTime")}
          value={formatHours(state.totalMs)}
        />
        <StatCard
          label={t("device.kpiSessions")}
          value={formatNumber(state.count)}
        />
        <StatCard
          label={t("device.kpiAvg")}
          value={state.count > 0 ? formatHMS(avgMs) : t("common.dash")}
        />
      </div>

      <div className="box">
        <h3>{t("device.todayTitle")}</h3>
        {openDay === null ? (
          <p className="sub">{t("stations.locked")}</p>
        ) : (
          <div className="dev-today">
            <span>
              {t("device.todaySessions")}: {formatNumber(todaySessions.length)}
            </span>
            <span>
              {t("device.todayTime")}: {formatHours(todayMs)}
            </span>
            <span>
              {t("device.todayRevenue")}:{" "}
              <b className="n">{formatRevenue(todayRevenue)}</b>
            </span>
          </div>
        )}
        {lastCompleted && (
          <p className="sub" style={{ marginTop: 8 }}>
            {t("device.lastSession")}:{" "}
            {formatDateTimeLocal(lastCompleted.startedAtUtc)} ·{" "}
            <span dir="ltr" className="n">
              {formatHMS(lastCompleted.durationMs ?? 0)}
            </span>
          </p>
        )}
      </div>

      <div className="box">
        <h3>{t("device.historyTitle")}</h3>
        {state.history.length === 0 ? (
          <p className="sub">{t("device.historyEmpty")}</p>
        ) : (
          <>
            <p className="sub" style={{ marginBottom: 8 }}>
              {t("device.partialHistory", {
                shown: formatNumber(state.history.length),
                total: formatNumber(state.total),
              })}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      <SessionSortHeader
                        key="startedAt"
                        label={t("device.colStart")}
                        sort={sort}
                        onSort={setSort}
                        initialDir="desc"
                      />
                    </th>
                    <th>
                      <SessionSortHeader
                        key="endedAt"
                        label={t("device.colEnd")}
                        sort={sort}
                        onSort={setSort}
                        initialDir="desc"
                      />
                    </th>
                    <th className="n" dir="ltr">
                      <SessionSortHeader
                        key="duration"
                        label={t("device.colDuration")}
                        sort={sort}
                        onSort={setSort}
                        initialDir="desc"
                      />
                    </th>
                    <th className="n" dir="ltr">
                      <SessionSortHeader
                        key="rate"
                        label={t("device.colRate")}
                        sort={sort}
                        onSort={setSort}
                        initialDir="desc"
                      />
                    </th>
                    <th className="n">{t("device.colRevenue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.history.map((s) => {
                    const live = s.endedAtUtc === null;
                    const rev =
                      s.endedAtUtc !== null && s.durationMs !== null
                        ? sessionRevenueMinor(s.durationMs, s.rateMinorAtStart)
                        : live && active?.id === s.id
                          ? sessionRevenueMinor(
                              elapsedMs(s.startedAtUtc, now),
                              s.rateMinorAtStart,
                            )
                          : null;
                    return (
                      <tr key={s.id} className={live ? "row-open" : undefined}>
                        <td>{formatDateTimeLocal(s.startedAtUtc)}</td>
                        <td>
                          {s.endedAtUtc === null
                            ? t("device.runningNow")
                            : formatDateTimeLocal(s.endedAtUtc)}
                        </td>
                        <td className="n" dir="ltr">
                          {s.durationMs !== null
                            ? formatHMS(s.durationMs)
                            : liveHMS(s.startedAtUtc, now)}
                        </td>
                        <td className="n" dir="ltr">
                          {s.rateMinorAtStart !== null
                            ? formatRateMajor(s.rateMinorAtStart)
                            : t("device.unpricedShort")}
                        </td>
                        <td className="n">
                          {rev !== null
                            ? formatRevenue(rev)
                            : t("device.legacyRevenue")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {remaining > 0 && (
              <div className="row2">
                <button type="button" className="btn ghost" onClick={more}>
                  {t("device.more", { remaining: formatNumber(remaining) })}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function SessionSortHeader({
  key,
  label,
  sort,
  onSort,
  initialDir,
}: {
  key: "startedAt" | "endedAt" | "duration" | "rate";
  label: string;
  sort: {
    key: "startedAt" | "endedAt" | "duration" | "rate";
    dir: SortDirection;
  } | null;
  onSort: (s: {
    key: "startedAt" | "endedAt" | "duration" | "rate";
    dir: SortDirection;
  }) => void;
  initialDir: SortDirection;
}) {
  const active = sort?.key === key;
  const dir = active ? sort.dir : null;
  return (
    <button
      type="button"
      className="sort-header"
      onClick={() => onSort(nextSort(sort, key, initialDir))}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
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
