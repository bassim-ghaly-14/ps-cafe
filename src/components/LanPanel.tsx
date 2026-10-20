import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import { lanPair, lanRefresh, lanStatus } from "../lan/bridge";
import type { LanPairing, LanStatus } from "../lan/bridge";
import { isLanClient } from "../db/client";
import LanPairView from "./LanPairView";

export default function LanPanel({
  setNotice,
}: {
  setNotice: (n: { kind: "ok" | "err"; text: string } | null) => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<LanStatus | null>(null);
  const [pairing, setPairing] = useState<LanPairing | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fail = useCallback(
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      setNotice({ kind: "err", text: `${t("lan.error")}: ${msg}` });
    },
    [setNotice, t],
  );

  const load = useCallback(async () => {
    try {
      const s = await lanStatus();
      if (mounted.current) {
        setStatus(s);
        setPairing(null);
      }
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  useEffect(() => {
    if (isLanClient()) return;
    void load();
  }, [load]);

  if (isLanClient()) return null;

  const onStatus = (s: LanStatus) => {
    if (mounted.current) {
      setStatus(s);
      setPairing(null);
    }
  };

  return (
    <div className="box" aria-labelledby="lan-title">
      <h3 id="lan-title">{t("lan.title")}</h3>
      <p className="sub">{t("lan.body")}</p>

      <div className="row2" role="status" aria-live="polite">
        <span className={`pill ${status?.running ? "on" : "off"}`}>
          {status?.running ? (
            <Wifi size={14} aria-hidden />
          ) : (
            <WifiOff size={14} aria-hidden />
          )}
          <span>
            {status?.running
              ? t("lan.running", { url: status.url ?? "" })
              : t("lan.stopped")}
          </span>
        </span>
        <button
          type="button"
          className="btn ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              onStatus(await lanRefresh());
            } catch (e) {
              fail(e);
            } finally {
              if (mounted.current) setBusy(false);
            }
          }}
          aria-label={t("lan.retry")}
        >
          <RefreshCw size={16} aria-hidden />
          <span>{t("lan.retry")}</span>
        </button>
      </div>

      {status?.error && (
        <p className="notice err" role="alert">
          {t("lan.serverError", { error: status.error })}
        </p>
      )}

      <LanPairView
        status={status}
        pairing={pairing}
        busy={busy}
        setBusy={setBusy}
        setNotice={setNotice}
        onStatus={onStatus}
        onPairing={(p) => mounted.current && setPairing(p)}
        lanPair={lanPair}
      />
    </div>
  );
}
