import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlaskConical } from "lucide-react";
import BottomNav, { useActiveTabState } from "./components/BottomNav";
import Splash from "./components/Splash";
import BusinessDayScreen from "./screens/BusinessDayScreen";
import StationsScreen from "./screens/StationsScreen";
import SettingsScreen from "./screens/SettingsScreen";
import { EGO_LOGO_ALT, EGO_LOGO_SRC } from "./brand";
import { useCafeData, useCafeActions } from "./hooks/useCafe";
import { ACTIVE_TAB_KEY, MIN_SPLASH_MS, parseActiveTab } from "./constants";
import { exitDemoMode } from "./dev/demoMode";
import type { DemoScenarioId } from "./dev/demoMode";
import "./i18n";
import "./styles.css";

function readSavedTab() {
  try {
    return parseActiveTab(localStorage.getItem(ACTIVE_TAB_KEY));
  } catch {
    return "day" as const;
  }
}

/**
 * App shell. Splash runs on every full React mount (launch + reload),
 * never on internal tab switches. Saved tab is restored after splash.
 * Operational state always comes from SQLite — never from the tab preference.
 */
export default function App() {
  const { t } = useTranslation();
  const [splashDone, setSplashDone] = useState(false);
  const [tab, setTab] = useActiveTabState(readSavedTab());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);
  const data = useCafeData();
  const actions = useCafeActions(data.refresh);

  // Developer Mode is session-scoped: it always starts OFF on reload and
  // must never persist across restarts (prevents a demo DB surviving into
  // a real shift). Entering installs an isolated demo DB; exiting discards
  // it and reloads production state.
  const [demoActive, setDemoActive] = useState(false);
  const [demoScenario, setDemoScenario] = useState<DemoScenarioId | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);

  const handleDemoEnter = useCallback(
    async (scenario: DemoScenarioId) => {
      setBusy(true);
      setDemoError(null);
      try {
        const { enterDemoMode } = await import("./dev/demoMode");
        const r = await enterDemoMode(scenario, Date.now());
        if (!r.ok) {
          setDemoError(t("dev.initFailed"));
          return { ok: false as const, error: r.error };
        }
        setDemoActive(true);
        setDemoScenario(scenario);
        await data.refresh();
        setNotice({ kind: "ok", text: t("dev.entered") });
        return { ok: true as const };
      } finally {
        setBusy(false);
      }
    },
    [data, t],
  );

  const handleDemoReseed = useCallback(
    async (scenario: DemoScenarioId) => {
      setBusy(true);
      setDemoError(null);
      try {
        const { exitDemoMode, enterDemoMode } = await import("./dev/demoMode");
        await exitDemoMode();
        const r = await enterDemoMode(scenario, Date.now());
        if (!r.ok) {
          setDemoActive(false);
          setDemoScenario(null);
          setDemoError(t("dev.initFailed"));
          await data.refresh();
          return { ok: false as const, error: r.error };
        }
        setDemoActive(true);
        setDemoScenario(scenario);
        await data.refresh();
        setNotice({ kind: "ok", text: t("dev.reseeded") });
        return { ok: true as const };
      } finally {
        setBusy(false);
      }
    },
    [data, t],
  );

  const handleDemoExit = useCallback(async () => {
    setBusy(true);
    try {
      await exitDemoMode();
      setDemoActive(false);
      setDemoScenario(null);
      setDemoError(null);
      await data.refresh();
      setNotice({ kind: "ok", text: t("dev.exited") });
    } finally {
      setBusy(false);
    }
  }, [data, t]);

  useEffect(() => {
    const t = setTimeout(() => setSplashDone(true), MIN_SPLASH_MS);
    return () => clearTimeout(t);
  }, []);

  const ready = splashDone && !data.loading;

  useEffect(() => {
    if (!ready) setNotice(null);
  }, [tab, ready]);

  if (!ready) return <Splash />;

  if (data.dbError) {
    return (
      <div className="app">
        <div className="box" role="alert">
          <h3>{t("app.dbErrorTitle")}</h3>
          <p className="sub">{t("app.dbErrorBody")}</p>
          <p className="sub mono" dir="ltr">
            {data.dbError}
          </p>
          <div className="row2">
            <button
              type="button"
              className="btn"
              onClick={() => window.location.reload()}
            >
              {t("app.retry")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img
            src={EGO_LOGO_SRC}
            alt={EGO_LOGO_ALT}
            className="brand-logo"
            width={44}
            height={50}
            decoding="async"
          />
          <span className="brand-text">
            {t("app.name")}
            <small>{t("app.tagline")}</small>
          </span>
        </div>
        {demoActive && (
          <div className="pill dev" role="status">
            <FlaskConical size={14} aria-hidden />
            <span>{t("dev.banner")}</span>
          </div>
        )}
        <div className={data.openDay ? "pill on" : "pill"} aria-live="polite">
          <i className="dot" aria-hidden />
          <span>{data.openDay ? t("day.openPill") : t("day.closedPill")}</span>
        </div>
      </header>
      <main className="main">
        {tab === "day" && (
          <BusinessDayScreen
            openDay={data.openDay}
            days={data.days}
            stations={data.stations}
            activeSessions={data.activeSessions}
            closedDaysCount={data.closedDaysCount}
            allTime={data.allTime}
            dayAgg={data.dayAgg}
            busy={busy}
            notice={notice}
            onOpen={async () => {
              setBusy(true);
              try {
                return await actions.openBusinessDay();
              } finally {
                setBusy(false);
              }
            }}
            onClose={async () => {
              setBusy(true);
              try {
                return await actions.closeBusinessDay();
              } finally {
                setBusy(false);
              }
            }}
            setNotice={setNotice}
          />
        )}
        {tab === "stations" && (
          <StationsScreen
            openDay={data.openDay}
            stations={data.stations}
            activeSessions={data.activeSessions}
            perStation={data.perStation}
            busy={busy}
            notice={notice}
            onStart={async (id) => {
              setBusy(true);
              try {
                return await actions.startStation(id);
              } finally {
                setBusy(false);
              }
            }}
            onStop={async (id) => {
              setBusy(true);
              try {
                return await actions.stopStation(id);
              } finally {
                setBusy(false);
              }
            }}
            setNotice={setNotice}
          />
        )}
        {tab === "settings" && (
          <SettingsScreen
            stations={data.stations}
            activeSessions={data.activeSessions}
            busy={busy}
            notice={notice}
            onSave={actions.saveStation}
            setNotice={setNotice}
            setBusy={setBusy}
            demoActive={demoActive}
            demoScenario={demoScenario}
            demoError={demoError}
            onDemoEnter={handleDemoEnter}
            onDemoReseed={handleDemoReseed}
            onDemoExit={handleDemoExit}
          />
        )}
      </main>
      <BottomNav active={tab} onChange={setTab} />
    </div>
  );
}
