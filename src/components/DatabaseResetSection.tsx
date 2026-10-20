import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import {
  DATABASE_RESET_PHRASE,
  checkDatabaseResetSafety,
  resetDatabase,
  type DatabaseResetBlock,
} from "../services/databaseReset";

interface Props {
  busy: boolean;
  setNotice: (n: { kind: "ok" | "err"; text: string } | null) => void;
  lanRunning: boolean;
  demoActive: boolean;
  onResetDone: () => Promise<void>;
}

function blockMessageKey(block: DatabaseResetBlock): string {
  switch (block.reason) {
    case "LAN_RUNNING":
      return "settings.dbResetBlockedLan";
    case "OPEN_DAY":
      return "settings.dbResetBlockedDay";
    case "ACTIVE_SESSIONS":
      return "settings.dbResetBlockedSessions";
    case "DEMO_ACTIVE":
      return "settings.dbResetBlockedDemo";
    case "LAN_CLIENT":
      return "settings.dbResetBlockedPhone";
  }
}

/** Final Settings section: destructive full-database reset. */
export default function DatabaseResetSection(props: Props) {
  const { busy, setNotice, lanRunning, demoActive, onResetDone } = props;
  const { t } = useTranslation();
  const [stage, setStage] = useState<"idle" | "confirm" | "phrase">("idle");
  const [phrase, setPhrase] = useState("");
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (stage === "phrase") {
      const id = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(id);
    }
  }, [stage]);

  useEffect(() => {
    if (stage === "idle") setPhrase("");
  }, [stage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stage !== "idle" && !runningRef.current) {
        setStage("idle");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage]);

  const close = () => {
    if (runningRef.current) return;
    setStage("idle");
  };
  const valid = phrase === DATABASE_RESET_PHRASE;

  const execute = async () => {
    if (runningRef.current || !valid) return;
    runningRef.current = true;
    setRunning(true);
    try {
      const r = await resetDatabase(() => lanRunning);
      if (r.ok) {
        setStage("idle");
        setPhrase("");
        await onResetDone();
        setNotice({ kind: "ok", text: t("settings.dbResetSuccess") });
      } else if (r.blocked) {
        setStage("idle");
        setNotice({ kind: "err", text: t(blockMessageKey(r.blocked)) });
      } else {
        setNotice({ kind: "err", text: t("settings.dbResetError") });
      }
    } catch {
      setNotice({ kind: "err", text: t("settings.dbResetError") });
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  return (
    <div className="box warn" aria-labelledby="db-reset-title">
      <h3 id="db-reset-title">{t("settings.dbResetTitle")}</h3>
      <p className="sub">{t("settings.dbResetBody")}</p>
      <div className="row2" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn stop"
          disabled={busy || running || demoActive}
          onClick={async () => {
            const blocked = await checkDatabaseResetSafety(() => lanRunning);
            if (blocked) {
              setNotice({ kind: "err", text: t(blockMessageKey(blocked)) });
              return;
            }
            setStage("confirm");
          }}
        >
          <Trash2 size={16} aria-hidden />
          <span>{t("settings.dbReset")}</span>
        </button>
      </div>
      {stage !== "idle" && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-label={t("settings.dbResetConfirmTitle")}
          >
            <h3>{t("settings.dbResetConfirmTitle")}</h3>
            <p className="sub">{t("settings.dbResetConfirmBody")}</p>
            {stage === "confirm" && (
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn stop"
                  onClick={() => setStage("phrase")}
                >
                  {t("settings.dbResetContinue")}
                </button>
                <button type="button" className="btn ghost" onClick={close}>
                  {t("settings.cancel")}
                </button>
              </div>
            )}
            {stage === "phrase" && (
              <>
                <label className="fld" htmlFor="db-reset-phrase">
                  <span dir="ltr">{t("settings.dbResetPhraseLabel")}</span>
                  <input
                    ref={inputRef}
                    id="db-reset-phrase"
                    type="text"
                    autoComplete="off"
                    dir="ltr"
                    value={phrase}
                    disabled={running}
                    onChange={(e) => setPhrase(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (valid && !running) void execute();
                      }
                    }}
                    aria-describedby="db-reset-phrase-hint"
                  />
                  <small id="db-reset-phrase-hint" className="sub">
                    {t("settings.dbResetPhraseHint")}
                  </small>
                </label>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn stop"
                    disabled={!valid || running}
                    onClick={() => void execute()}
                  >
                    {running
                      ? t("common.loading")
                      : t("settings.dbResetExecute")}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={running}
                    onClick={close}
                  >
                    {t("settings.cancel")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
