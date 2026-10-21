import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveDb } from "../db/client";
import { canCloseDay } from "../domain/businessDay";
import { parseHourlyRateInput } from "../domain/pricing";
import { canStartSessionDetailed } from "../domain/rentalSession";
import { isReadOnly } from "../mode/visitor";
import * as dayRepo from "../repositories/businessDayRepo";
import * as stationRepo from "../repositories/stationRepo";
import * as sessionRepo from "../repositories/sessionRepo";
import { formatHMS } from "../utils/time";
import type { BusinessDay, RentalSession, Station } from "../domain/types";
import type { DayAggregate } from "../repositories/sessionRepo";

export interface CafeResult {
  ok: boolean;
  messageKey: string;
  params?: Record<string, unknown>;
}

/**
 * Synchronisation freshness for the LAN (visitor/mobile) client.
 *
 * - `connecting`   : first fetch has not settled yet.
 * - `loading`      : a fetch (initial or revalidation) is in flight.
 * - `synchronized` : last fetch succeeded and data reflects the host.
 * - `reconnecting` : a revalidation is in flight after a prior success.
 * - `failed`       : initial fetch failed and no valid snapshot exists yet.
 * - `stale`        : a fetch failed after a prior success; the last valid
 *                    snapshot is retained but must not be shown as current.
 */
export type SyncStatus =
  | "connecting"
  | "loading"
  | "synchronized"
  | "reconnecting"
  | "failed"
  | "stale";

export interface CafeState {
  loading: boolean;
  dbError: string | null;
  openDay: BusinessDay | null;
  days: BusinessDay[];
  stations: Station[];
  activeSessions: RentalSession[];
  closedDaysCount: number;
  allTime: { count: number; totalMs: number };
  dayAgg: DayAggregate;
  dayAggregates: Map<number, DayAggregate>;
  perStation: Map<number, { count: number; totalMs: number }>;
  /** Truthful synchronisation state (desktop is always "synchronized"). */
  syncStatus: SyncStatus;
  /** Unix ms of the last successful authoritative fetch, or null. */
  lastSyncedAt: number | null;
  /** True when a retained snapshot may be stale and must not be presented as current. */
  isStale: boolean;
  refresh: () => Promise<void>;
}

export function repoCode(e: unknown): string {
  if (
    e instanceof Error &&
    "code" in e &&
    typeof (e as { code: unknown }).code === "string"
  ) {
    return (e as { code: string }).code;
  }
  if (
    e instanceof Error &&
    /UNIQUE|uq_open_day|uq_active_session/.test(e.message)
  )
    return "CONSTRAINT";
  return "UNKNOWN";
}

export function useCafeData() {
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<BusinessDay | null>(null);
  const [days, setDays] = useState<BusinessDay[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [activeSessions, setActiveSessions] = useState<RentalSession[]>([]);
  const [closedDaysCount, setClosedDaysCount] = useState(0);
  const [allTime, setAllTime] = useState({ count: 0, totalMs: 0 });
  const [dayAgg, setDayAgg] = useState<DayAggregate>({
    count: 0,
    totalMs: 0,
    revenueMinor: 0,
  });
  const [dayAggregates, setDayAggregates] = useState(
    new Map<number, DayAggregate>(),
  );
  const [perStation, setPerStation] = useState(
    new Map<number, { count: number; totalMs: number }>(),
  );
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    isReadOnly() ? "connecting" : "synchronized",
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [isStale, setIsStale] = useState(false);
  const mounted = useRef(true);
  const requestSeq = useRef(0);
  /** True once the first fetch has settled (controls the splash `loading` flag). */
  const firstFetch = useRef(false);
  /** True once at least one authoritative fetch has succeeded. */
  const syncedRef = useRef(false);
  /** Interval handle for visitor-mode revalidation polling. */
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * Revalidation interval: visitor (read-only) clients re-fetch the
   * authoritative snapshot periodically so host changes become visible.
   * Desktop clients never poll — their writes flow straight to SQLite.
   */
  const REVALIDATE_INTERVAL_MS = 10_000;

  const refresh = useCallback(async (opts?: { markStaleOnError?: boolean }) => {
    if (!mounted.current) return;
    const seq = ++requestSeq.current;
    const isInitial = !firstFetch.current;
    if (isInitial) {
      setLoading(true);
    }
    setSyncStatus(isInitial ? "loading" : "reconnecting");
    try {
      await getActiveDb();
      const [open, history, stList, active, closed, all, aggregates] =
        await Promise.all([
          dayRepo.getOpenDay(),
          dayRepo.listDays(50),
          stationRepo.listStations(),
          sessionRepo.listActiveSessions(),
          dayRepo.countClosedDays(),
          sessionRepo.aggregateAllTime(),
          sessionRepo.listDayAggregates(),
        ]);
      const byDay = new Map(
        aggregates.map((a) => [a.dayId, { ...a } as DayAggregate]),
      );
      let cur = { count: 0, totalMs: 0, revenueMinor: 0 };
      let per = new Map<number, { count: number; totalMs: number }>();
      if (open) {
        cur = byDay.get(open.id) ?? cur;
        const byStation = await sessionRepo.aggregateByStation(open.id);
        per = new Map(
          byStation.map((b) => [
            b.stationId,
            { count: b.count, totalMs: b.totalMs },
          ]),
        );
      }
      // Ignore stale responses: only the latest request may apply its snapshot.
      if (!mounted.current || seq !== requestSeq.current) return;
      setDbError(null);
      setOpenDay(open);
      setDays(history);
      setStations(stList);
      setActiveSessions(active);
      setClosedDaysCount(closed);
      setAllTime(all);
      setDayAgg(cur);
      setDayAggregates(byDay);
      setPerStation(per);
      setSyncStatus("synchronized");
      setLastSyncedAt(Date.now());
      setIsStale(false);
      firstFetch.current = true;
      syncedRef.current = true;
    } catch (e) {
      if (!mounted.current || seq !== requestSeq.current) return;
      // Never replace the last valid snapshot with empty/seeded/local data.
      const message = e instanceof Error ? e.message : String(e);
      setDbError(message);
      const markStale = Boolean(opts?.markStaleOnError) || syncedRef.current;
      setSyncStatus(markStale ? "stale" : "failed");
      setIsStale(markStale);
    } finally {
      if (!mounted.current || seq !== requestSeq.current) return;
      if (isInitial) {
        setLoading(false);
        firstFetch.current = true;
      }
    }
  }, []);

  useEffect(() => {
    if (!isReadOnly()) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return undefined;
    }
    intervalRef.current = setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh({ markStaleOnError: true });
      }
    }, REVALIDATE_INTERVAL_MS);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isReadOnly(), refresh]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (isReadOnly() && document.visibilityState === "visible") {
        void refresh({ markStaleOnError: true });
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [isReadOnly(), refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    loading,
    dbError,
    openDay,
    days,
    stations,
    activeSessions,
    closedDaysCount,
    allTime,
    dayAgg,
    dayAggregates,
    perStation,
    syncStatus,
    lastSyncedAt,
    isStale,
    refresh,
    mounted,
  };
}

export function useCafeActions(refresh: () => Promise<void>): {
  openBusinessDay: () => Promise<CafeResult>;
  closeBusinessDay: () => Promise<CafeResult>;
  startStation: (stationId: number) => Promise<CafeResult>;
  stopStation: (stationId: number) => Promise<CafeResult>;
  saveStation: (
    id: number | null,
    name: string,
    color: string,
    visible: boolean,
    active: boolean,
    hourlyRateMinor: number | string,
  ) => Promise<CafeResult>;
} {
  const openBusinessDay = async (): Promise<CafeResult> => {
    if (isReadOnly()) return { ok: false, messageKey: "common.readOnly" };
    try {
      const existing = await dayRepo.getOpenDay();
      if (existing) {
        await refresh();
        return { ok: false, messageKey: "day.alreadyOpen" };
      }
      await dayRepo.openDay(Date.now());
      await refresh();
      return { ok: true, messageKey: "day.opened" };
    } catch {
      await refresh();
      return { ok: false, messageKey: "day.alreadyOpen" };
    }
  };

  const closeBusinessDay = async (): Promise<CafeResult> => {
    if (isReadOnly()) return { ok: false, messageKey: "common.readOnly" };
    const open = await dayRepo.getOpenDay();
    if (!open) {
      await refresh();
      return { ok: false, messageKey: "day.noOpenDay" };
    }
    const active = await sessionRepo.listActiveSessionsForDay(open.id);
    const gate = canCloseDay(active.length);
    if (!gate.ok) {
      return {
        ok: false,
        messageKey: "BLOCKED",
        params: { count: active.length },
      };
    }
    try {
      await dayRepo.closeDay(open.id, Date.now());
      await refresh();
      return { ok: true, messageKey: "day.closed" };
    } catch (e) {
      await refresh();
      const code = repoCode(e);
      if (code === "DAY_HAS_ACTIVE_SESSIONS" || code === "CONSTRAINT") {
        const still = await sessionRepo.listActiveSessionsForDay(open.id);
        return {
          ok: false,
          messageKey: "BLOCKED",
          params: { count: still.length },
        };
      }
      return { ok: false, messageKey: "common.error" };
    }
  };

  const startStation = async (stationId: number): Promise<CafeResult> => {
    if (isReadOnly()) return { ok: false, messageKey: "common.readOnly" };
    const open = await dayRepo.getOpenDay();
    const station = await stationRepo.getStation(stationId);
    const existing = await sessionRepo.getActiveSession(stationId);
    const gate = canStartSessionDetailed({
      dayOpen: open !== null,
      stationEligible:
        (station?.isActive ?? false) && (station?.isVisible ?? false),
      stationBusy: existing !== null,
    });
    if (!gate.ok) {
      const map: Record<string, string> = {
        DAY_CLOSED: "stations.needsOpenDay",
        STATION_INACTIVE: "stations.inactiveStation",
        STATION_BUSY: "stations.alreadyRunning",
      };
      return { ok: false, messageKey: map[gate.code] ?? "common.error" };
    }
    if (!open || !station) return { ok: false, messageKey: "common.error" };
    try {
      await sessionRepo.startSession(stationId, open.id, Date.now());
      await refresh();
      return {
        ok: true,
        messageKey: "stations.started",
        params: { name: station.name },
      };
    } catch (e) {
      await refresh();
      const code = repoCode(e);
      if (code === "CONSTRAINT")
        return { ok: false, messageKey: "stations.alreadyRunning" };
      if (code === "DAY_CLOSED")
        return { ok: false, messageKey: "stations.needsOpenDay" };
      if (code === "STATION_INACTIVE")
        return { ok: false, messageKey: "stations.inactiveStation" };
      return { ok: false, messageKey: "common.error" };
    }
  };

  const stopStation = async (stationId: number): Promise<CafeResult> => {
    if (isReadOnly()) return { ok: false, messageKey: "common.readOnly" };
    const active = await sessionRepo.getActiveSession(stationId);
    if (!active) return { ok: false, messageKey: "stations.noSession" };
    const station = await stationRepo.getStation(stationId);
    try {
      const done = await sessionRepo.stopSession(active.id, Date.now());
      await refresh();
      // stations.stopped interpolates {{name}} and {{duration}}; both must be
      // supplied or i18next renders the tokens literally in the UI.
      return {
        ok: true,
        messageKey: "stations.stopped",
        params: {
          name: station?.name ?? `#${stationId}`,
          duration: formatHMS(done.durationMs ?? 0),
        },
      };
    } catch {
      await refresh();
      return { ok: false, messageKey: "stations.noSession" };
    }
  };

  const saveStation = async (
    id: number | null,
    name: string,
    color: string,
    visible: boolean,
    active: boolean,
    hourlyRateMinor: number | string,
  ): Promise<CafeResult> => {
    if (isReadOnly()) return { ok: false, messageKey: "common.readOnly" };
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (trimmed.length === 0)
      return { ok: false, messageKey: "settings.nameRequired" };
    if (trimmed.length > 60)
      return { ok: false, messageKey: "settings.nameTooLong" };
    if (!/^#[0-9a-fA-F]{6}$/.test(color))
      return { ok: false, messageKey: "common.error" };
    // Rate is accepted as integer minor units (repo path) or a major-unit
    // string (form path). Empty / malformed / negative input is rejected —
    // never silently coerced to 0.
    let minor: number;
    if (typeof hourlyRateMinor === "number") {
      minor = hourlyRateMinor;
    } else {
      const parsed = parseHourlyRateInput(hourlyRateMinor);
      if (!parsed.ok)
        return {
          ok: false,
          messageKey:
            parsed.code === "RATE_REQUIRED"
              ? "settings.rateRequired"
              : "settings.rateInvalid",
        };
      minor = parsed.minor;
    }
    if (
      !Number.isInteger(minor) ||
      minor < 0 ||
      minor > 1_000_000 ||
      !Number.isFinite(minor)
    ) {
      return { ok: false, messageKey: "settings.rateInvalid" };
    }
    try {
      const all = await stationRepo.listStations();
      const dup = all.some((s) => s.id !== id && s.name.trim() === trimmed);
      if (dup) return { ok: false, messageKey: "settings.nameTaken" };
      if (id === null) {
        await stationRepo.createStation(trimmed, color, minor);
        await refresh();
        return { ok: true, messageKey: "settings.added" };
      }
      if (!active) {
        const running = await sessionRepo.getActiveSession(id);
        if (running)
          return { ok: false, messageKey: "settings.cannotDeactivateRunning" };
      }
      await stationRepo.updateStation(id, {
        name: trimmed,
        colorHex: color,
        isVisible: visible,
        isActive: active,
        hourlyRateMinor: minor,
      });
      await refresh();
      return { ok: true, messageKey: "settings.updated" };
    } catch (e) {
      await refresh();
      if (repoCode(e) === "STATION_HAS_ACTIVE_SESSION") {
        return { ok: false, messageKey: "settings.cannotDeactivateRunning" };
      }
      return { ok: false, messageKey: "common.error" };
    }
  };

  return {
    openBusinessDay,
    closeBusinessDay,
    startStation,
    stopStation,
    saveStation,
  };
}
