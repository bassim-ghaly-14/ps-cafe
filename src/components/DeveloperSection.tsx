import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Code2,
  FlaskConical,
  LogOut,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import PinDialog from "./PinDialog";
import { isDevtoolsEnabled, verifyDeveloperPin } from "../dev/developerMode";
import {
  DEMO_SCENARIOS,
  enterDemoMode,
  exitDemoMode,
  isDemoScenario,
  type DemoScenarioId,
} from "../dev/demoMode";

interface Props {
  demoActive: boolean;
  demoScenario: DemoScenarioId | null;
  demoError: string | null;
  busy: boolean;
  onEnter: (
    scenario: DemoScenarioId,
  ) => Promise<{ ok: boolean; error?: string }>;
  onReseed: (
    scenario: DemoScenarioId,
  ) => Promise<{ ok: boolean; error?: string }>;
  onExit: () => Promise<void>;
}

/**
 * Developer-only section at the bottom of Settings. Rendered only when the
 * devtools capability flag is compiled in (dev / internal builds). The PIN
 * is required on every normal->developer transition and is never persisted.
 */
export default function DeveloperSection(props: Props) {
  const {
    demoActive,
    demoScenario,
    demoError,
    busy,
    onEnter,
    onReseed,
    onExit,
  } = props;
  const { t } = useTranslation();
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<DemoScenarioId>(
    demoScenario ?? "full",
  );
  const [confirmReset, setConfirmReset] = useState(false);

  // Keep the local scenario selector in sync with the actual active
  // scenario so reopening Settings always shows the true current state
  // instead of a stale initial value.
  useEffect(() => {
    if (demoScenario !== null) setScenario(demoScenario);
  }, [demoScenario]);

  const devtoolsEnabled = isDevtoolsEnabled();

  const requestEnable = () => {
    setPinError(null);
    setPinOpen(true);
  };

  const submitPin = async (pin: string) => {
    if (!verifyDeveloperPin(pin)) {
      setPinError(t("dev.pinWrong"));
      return;
    }
    setPinOpen(false);
    setPinError(null);
    const r = await onEnter(scenario);
    if (!r.ok) setPinError(r.error ?? t("common.error"));
  };

  // Compile-time gate (dev / internal builds only): hooks above stay
  // unconditional so Rules-of-Hooks order never shifts between builds.
  // Production Windows builds keep this section compiled out by design
  // (ADR-016) — never bypass this check to force the toggle visible.
  if (!devtoolsEnabled) return null;

  return (
    <div className="box dev-box">
      <h3 className="dev-title">
        <Code2 size={18} aria-hidden />
        <span>{t("dev.title")}</span>
        <span className={demoActive ? "tag on" : "tag"}>
          {demoActive ? t("dev.active") : t("dev.inactive")}
        </span>
      </h3>
      <p className="sub">{t("dev.blurb")}</p>
      {!demoActive ? (
        <div className="row2">
          <label className="fld" style={{ margin: 0 }}>
            <span>{t("dev.scenarioLabel")}</span>
            <select
              value={scenario}
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value;
                if (isDemoScenario(v)) setScenario(v);
              }}
              aria-label={t("dev.scenarioLabel")}
            >
              {DEMO_SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {t(s.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={requestEnable}
          >
            <FlaskConical size={16} aria-hidden />
            <span>{t("dev.enable")}</span>
          </button>
        </div>
      ) : (
        <>
          {demoError && (
            <p className="notice err" role="alert">
              {demoError}
            </p>
          )}
          <div className="dev-banner" role="status">
            <FlaskConical size={16} aria-hidden />
            <span>{t("dev.banner")}</span>
          </div>
          <div className="row2">
            <label className="fld" style={{ margin: 0 }}>
              <span>{t("dev.scenarioLabel")}</span>
              <select
                value={demoScenario ?? scenario}
                disabled={busy}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isDemoScenario(v)) setScenario(v);
                }}
                aria-label={t("dev.scenarioLabel")}
              >
                {DEMO_SCENARIOS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {t(s.labelKey)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => setConfirmReset(true)}
            >
              <RotateCcw size={16} aria-hidden />
              <span>{t("dev.reset")}</span>
            </button>
            <button
              type="button"
              className="btn stop"
              disabled={busy}
              onClick={() => void onExit()}
            >
              <LogOut size={16} aria-hidden />
              <span>{t("dev.exit")}</span>
            </button>
          </div>
          <p className="sub" style={{ marginTop: 8 }}>
            <ShieldCheck
              size={14}
              aria-hidden
              style={{ verticalAlign: "-2px", marginInlineEnd: 4 }}
            />
            {t("dev.isolationNote")}
          </p>
        </>
      )}
      <PinDialog
        open={pinOpen}
        error={pinError}
        busy={busy}
        onSubmit={(pin) => void submitPin(pin)}
        onCancel={() => setPinOpen(false)}
      />
      {confirmReset && (
        <ConfirmDialog
          title={t("dev.resetTitle")}
          body={t("dev.resetBody")}
          confirmLabel={t("dev.resetConfirm")}
          cancelLabel={t("settings.cancel")}
          onConfirm={() => {
            setConfirmReset(false);
            void onReseed(scenario);
          }}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}

export { enterDemoMode, exitDemoMode };
