import { useTranslation } from "react-i18next";
import StationCard from "../components/StationCard";
import { useNow } from "../hooks/useNow";
import type { CafeResult } from "../hooks/useCafe";
import type { BusinessDay, RentalSession, Station } from "../domain/types";

interface Props {
  openDay: BusinessDay | null;
  stations: Station[];
  activeSessions: RentalSession[];
  perStation: Map<number, { count: number; totalMs: number }>;
  busy: boolean;
  notice: { kind: "ok" | "err"; text: string } | null;
  onStart: (id: number) => Promise<CafeResult>;
  onStop: (id: number) => Promise<CafeResult>;
  onOpenStation: (id: number) => void;
  setNotice: (n: { kind: "ok" | "err"; text: string } | null) => void;
}

/** Stations screen: live cards from SQLite, never a hardcoded array. */
export default function StationsScreen(props: Props) {
  const { openDay, stations, activeSessions, perStation, busy, notice } = props;
  const { onStart, onStop, onOpenStation, setNotice } = props;
  const { t } = useTranslation();
  const now = useNow(activeSessions.length > 0 || openDay !== null);
  const activeByStation = new Map(activeSessions.map((s) => [s.stationId, s]));
  const visible = stations.filter((s) => s.isVisible);

  const act = async (id: number, running: boolean) => {
    if (busy) return;
    const r = running ? await onStop(id) : await onStart(id);
    const params = r.params as Record<string, string> | undefined;
    setNotice({ kind: r.ok ? "ok" : "err", text: t(r.messageKey, params) });
  };

  return (
    <section aria-label={t("nav.stations")}>
      {notice && (
        <p
          className={notice.kind === "ok" ? "notice ok" : "notice err"}
          role="status"
        >
          {notice.text}
        </p>
      )}
      {!openDay && <div className="lock">{t("stations.locked")}</div>}
      {visible.length === 0 ? (
        <div className="box">
          <p className="sub">{t("stations.empty")}</p>
        </div>
      ) : (
        <div className="grid cards">
          {visible.map((s) => {
            const sess = activeByStation.get(s.id);
            const agg = perStation.get(s.id) ?? { count: 0, totalMs: 0 };
            return (
              <StationCard
                key={s.id}
                station={s}
                running={sess !== undefined}
                startUtc={sess ? sess.startedAtUtc : null}
                now={now}
                dayOpen={openDay !== null}
                countToday={agg.count}
                msToday={agg.totalMs}
                busy={busy}
                onStart={() => act(s.id, false)}
                onStop={() => act(s.id, true)}
                onOpen={() => onOpenStation(s.id)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
