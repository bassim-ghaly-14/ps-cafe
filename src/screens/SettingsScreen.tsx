import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Eye,
  EyeOff,
  Palette,
  Pencil,
  Plus,
  Power,
  PowerOff,
} from "lucide-react";
import { formatRateMajor } from "../domain/pricing";
import ConfirmDialog from "../components/ConfirmDialog";
import DeveloperSection from "../components/DeveloperSection";
import LanPanel from "../components/LanPanel";
import { isLanClient } from "../db/client";
import type { CafeResult } from "../hooks/useCafe";
import type { RentalSession, Station } from "../domain/types";
import type { DemoScenarioId } from "../dev/demoMode";

interface Props {
  stations: Station[];
  activeSessions: RentalSession[];
  busy: boolean;
  notice: { kind: "ok" | "err"; text: string } | null;
  onSave: (
    id: number | null,
    name: string,
    color: string,
    visible: boolean,
    active: boolean,
    hourlyRateMinor: string,
  ) => Promise<CafeResult>;
  setNotice: (n: { kind: "ok" | "err"; text: string } | null) => void;
  setBusy: (b: boolean) => void;
  demoActive: boolean;
  demoScenario: DemoScenarioId | null;
  demoError: string | null;
  onDemoEnter: (
    scenario: DemoScenarioId,
  ) => Promise<{ ok: boolean; error?: string }>;
  onDemoReseed: (
    scenario: DemoScenarioId,
  ) => Promise<{ ok: boolean; error?: string }>;
  onDemoExit: () => Promise<void>;
}

const PALETTE = [
  "#2ee6ff",
  "#b36bff",
  "#ff4d9d",
  "#ffc233",
  "#19e3a1",
  "#ff7a3d",
];

/** Settings: station add/rename/recolor/show-hide/activate + developer tools. */
export default function SettingsScreen(props: Props) {
  const { stations, activeSessions, busy, notice, onSave, setNotice, setBusy } =
    props;
  const {
    demoActive,
    demoScenario,
    demoError,
    onDemoEnter,
    onDemoReseed,
    onDemoExit,
  } = props;
  const { t } = useTranslation();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0] ?? "#2ee6ff");
  const [visible, setVisible] = useState(true);
  const [active, setActive] = useState(true);
  const [rate, setRate] = useState("0");
  const [confirmOff, setConfirmOff] = useState<Station | null>(null);

  const startEdit = (s: Station | null) => {
    if (s === null) {
      setEditing("new");
      setName("");
      setColor(PALETTE[stations.length % PALETTE.length] ?? "#2ee6ff");
      setVisible(true);
      setActive(true);
      setRate("0");
    } else {
      setEditing(s.id);
      setName(s.name);
      setColor(s.colorHex);
      setVisible(s.isVisible);
      setActive(s.isActive);
      setRate(formatRateMajor(s.hourlyRateMinor));
    }
  };

  const submit = async () => {
    if (busy || editing === null) return;
    setBusy(true);
    try {
      const id = editing === "new" ? null : editing;
      const r = await onSave(id, name, color, visible, active, rate);
      const params = r.params as Record<string, string> | undefined;
      setNotice({
        kind: r.ok ? "ok" : "err",
        text: t(r.messageKey, params),
      });
      if (r.ok) setEditing(null);
    } finally {
      setBusy(false);
    }
  };

  const quickSave = async (
    s: Station,
    next: { visible: boolean; active: boolean },
  ) => {
    if (busy) return;
    if (
      activeSessions.some((a) => a.stationId === s.id) &&
      (!next.visible || !next.active)
    ) {
      setNotice({ kind: "err", text: t("settings.cannotDeactivateRunning") });
      return;
    }
    setBusy(true);
    try {
      const r = await onSave(
        s.id,
        s.name,
        s.colorHex,
        next.visible,
        next.active,
        formatRateMajor(s.hourlyRateMinor),
      );
      setNotice({ kind: r.ok ? "ok" : "err", text: t(r.messageKey) });
    } finally {
      setBusy(false);
    }
  };

  const requestDeactivate = (s: Station) => {
    if (busy) return;
    if (activeSessions.some((a) => a.stationId === s.id)) {
      setNotice({ kind: "err", text: t("settings.cannotDeactivateRunning") });
      return;
    }
    setConfirmOff(s);
  };

  const body = (
    <section className="settings-section" aria-label={t("nav.settings")}>
      {notice && (
        <p
          className={notice.kind === "ok" ? "notice ok" : "notice err"}
          role="status"
        >
          {notice.text}
        </p>
      )}
      <div className="box">
        <h3>{t("settings.cardsTitle")}</h3>
        {/* Column labels mirror the station row cells exactly:
            swatch | name | active status | actions. */}
        <div className="settings-station-row head">
          <span />
          <span className="h">{t("settings.colName")}</span>
          <span className="h hide-sm">{t("settings.colActive")}</span>
          <span className="h">{t("settings.colActions")}</span>
        </div>
        {stations.map((s) => (
          <div className="settings-station-row" key={s.id}>
            <span
              className="sw"
              style={{ background: s.colorHex }}
              aria-hidden
            />
            <span className="set-name" title={s.name}>
              {s.name}
            </span>
            <span className="set-meta sub hide-sm">
              {s.isActive ? t("settings.activate") : t("settings.deactivate")}
            </span>
            <span className="set-ops settings-station-actions">
              <button
                type="button"
                className="mini"
                disabled={busy}
                onClick={() => startEdit(s)}
                aria-label={t("settings.edit")}
                title={t("settings.edit")}
              >
                <Pencil size={14} aria-hidden />
                <span>{t("settings.edit")}</span>
              </button>
              <button
                type="button"
                className="mini"
                disabled={busy}
                onClick={() =>
                  quickSave(s, { visible: !s.isVisible, active: s.isActive })
                }
                aria-label={
                  s.isVisible ? t("settings.hide") : t("settings.show")
                }
                title={s.isVisible ? t("settings.hide") : t("settings.show")}
              >
                {s.isVisible ? (
                  <EyeOff size={14} aria-hidden />
                ) : (
                  <Eye size={14} aria-hidden />
                )}
                <span>
                  {s.isVisible ? t("settings.hide") : t("settings.show")}
                </span>
              </button>
              <button
                type="button"
                className="mini"
                disabled={busy}
                onClick={() => startEdit(s)}
                aria-label={t("settings.changeColor")}
                title={t("settings.changeColor")}
              >
                <Palette size={14} aria-hidden />
                <span>{t("settings.changeColor")}</span>
              </button>
              <button
                type="button"
                className={`mini danger ${s.isActive ? "" : "ghost"}`}
                disabled={busy}
                onClick={() =>
                  s.isActive
                    ? requestDeactivate(s)
                    : quickSave(s, { visible: s.isVisible, active: true })
                }
                aria-label={
                  s.isActive ? t("settings.deactivate") : t("settings.activate")
                }
                title={
                  s.isActive ? t("settings.deactivate") : t("settings.activate")
                }
              >
                {s.isActive ? (
                  <PowerOff size={14} aria-hidden />
                ) : (
                  <Power size={14} aria-hidden />
                )}
                <span>
                  {s.isActive
                    ? t("settings.deactivate")
                    : t("settings.activate")}
                </span>
              </button>
            </span>
          </div>
        ))}
        <div className="row2">
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => startEdit(null)}
          >
            <Plus size={16} aria-hidden />
            <span>{t("settings.add")}</span>
          </button>
          <span className="sub">
            {t("settings.deviceCount", { count: stations.length })}
          </span>
        </div>
        <p className="sub" style={{ marginTop: 8 }}>
          {t("settings.note")}
        </p>
      </div>
      <LanPanel setNotice={setNotice} />
      {!isLanClient() && (
        <DeveloperSection
          demoActive={demoActive}
          demoScenario={demoScenario}
          demoError={demoError}
          busy={busy}
          onEnter={onDemoEnter}
          onReseed={onDemoReseed}
          onExit={onDemoExit}
        />
      )}
    </section>
  );

  if (editing === null && confirmOff === null) return body;

  return (
    <>
      {body}
      {editing !== null && (
        <div className="box settings-edit-box">
          <h3>{editing === "new" ? t("settings.add") : t("settings.edit")}</h3>
          <label className="fld" htmlFor="station-name">
            <span>{t("settings.nameLabel")}</span>
            <input
              id="station-name"
              type="text"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="fld" htmlFor="station-rate">
            <span>{t("settings.rateLabel")}</span>
            <input
              id="station-rate"
              type="number"
              inputMode="decimal"
              min={0}
              max={10000}
              step="0.5"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              aria-describedby="rate-help"
              dir="ltr"
            />
            <small id="rate-help" className="sub">
              {t("settings.rateHelp")}
            </small>
          </label>
          <label className="fld" htmlFor="station-color">
            <span>{t("settings.colorLabel")}</span>
            <input
              id="station-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
          <div className="row2">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={submit}
            >
              {t("settings.save")}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setEditing(null)}
            >
              {t("settings.cancel")}
            </button>
          </div>
        </div>
      )}
      {confirmOff && (
        <ConfirmDialog
          title={t("settings.confirmDeactivateTitle")}
          body={t("settings.confirmDeactivateBody", { name: confirmOff.name })}
          confirmLabel={t("settings.confirm")}
          cancelLabel={t("settings.cancel")}
          onConfirm={() =>
            quickSave(confirmOff, {
              visible: confirmOff.isVisible,
              active: false,
            }).finally(() => setConfirmOff(null))
          }
          onCancel={() => setConfirmOff(null)}
        />
      )}
    </>
  );
}
