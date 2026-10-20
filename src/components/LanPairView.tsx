import { useTranslation } from "react-i18next";
import { Copy, Eye, QrCode } from "lucide-react";
import { useState } from "react";
import { lanRevokeAll, lanSelectInterface, lanSetEnabled } from "../lan/bridge";
import type { LanPairing, LanStatus } from "../lan/bridge";

interface Props {
  status: LanStatus | null;
  pairing: LanPairing | null;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setNotice: (n: { kind: "ok" | "err"; text: string } | null) => void;
  onStatus: (s: LanStatus) => void;
  onPairing: (p: LanPairing) => void;
  lanPair: () => Promise<LanPairing>;
}

export default function LanPairView(props: Props) {
  const {
    status,
    pairing,
    busy,
    setBusy,
    setNotice,
    onStatus,
    onPairing,
    lanPair,
  } = props;
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    setNotice({ kind: "err", text: `${t("lan.error")}: ${msg}` });
  };

  const copyUrl = async () => {
    const url = pairing?.payload ?? status?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <>
      <div className="row2">
        <label className="switch">
          <input
            type="checkbox"
            checked={status?.enabled ?? false}
            disabled={busy}
            onChange={async (e) => {
              setBusy(true);
              try {
                onStatus(await lanSetEnabled(e.target.checked));
              } catch (err) {
                fail(err);
              } finally {
                setBusy(false);
              }
            }}
          />
          <span>{t("lan.enable")}</span>
        </label>
      </div>
      {/* The gateway is permanently read-only: there is no write toggle to
          offer, only a statement of the fact. */}
      <p className="sub lan-readonly">
        <Eye size={14} aria-hidden style={{ verticalAlign: "-2px" }} />{" "}
        {t("lan.readOnlyNotice")}
      </p>

      {status && status.candidates.length > 1 && (
        <label className="fld" htmlFor="lan-iface">
          <span>{t("lan.ifaceLabel")}</span>
          <select
            id="lan-iface"
            value={status.address ?? ""}
            disabled={busy}
            onChange={async (e) => {
              setBusy(true);
              try {
                onStatus(await lanSelectInterface(e.target.value));
              } catch (err) {
                fail(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            {status.candidates.map((c) => (
              <option key={`${c.name}/${c.address}`} value={c.address}>
                {c.name} — {c.address}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="row2">
        <button
          type="button"
          className="btn"
          disabled={busy || !status?.running}
          onClick={async () => {
            setBusy(true);
            try {
              onPairing(await lanPair());
            } catch (err) {
              fail(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <QrCode size={16} aria-hidden />
          <span>{t("lan.showQr")}</span>
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={busy || (status?.pairedDevices ?? 0) === 0}
          onClick={async () => {
            setBusy(true);
            try {
              onStatus(await lanRevokeAll());
            } catch (err) {
              fail(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <span>
            {t("lan.revokeAll", { count: status?.pairedDevices ?? 0 })}
          </span>
        </button>
      </div>

      {pairing && (
        <div className="lan-qr" aria-live="polite">
          <div
            className="lan-qr-img"
            role="img"
            aria-label={t("lan.qrAlt")}
            dangerouslySetInnerHTML={{ __html: pairing.qrSvg }}
          />
          <p className="sub lan-url" dir="ltr">
            {pairing.payload}
          </p>
          <div className="row2">
            <button
              type="button"
              className={`btn ghost${copied ? " copied" : ""}`}
              onClick={copyUrl}
            >
              <Copy size={16} aria-hidden />
              <span>{copied ? t("lan.copied") : t("lan.copy")}</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
