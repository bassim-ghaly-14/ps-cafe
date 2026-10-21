import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { Smartphone } from "lucide-react";
import { clearLanToken, readLanToken } from "../db/http";
import { __resetDbForTests, isLanClient } from "../db/client";
import { useCafeData } from "../hooks/useCafe";

/**
 * Phone-client chrome. Desktop renders nothing. On a paired phone this
 * shows a compact banner (connection state + forget-pairing); when no
 * token is present it explains how to pair instead of failing silently
 * at the first database call.
 *
 * Crucially, pairing/QR navigation is NOT presented as proof of data
 * synchronisation: the banner reflects the actual sync status reported
 * by `useCafeData`, which only becomes "synchronized" after a valid
 * authoritative response from the host has been received and applied.
 */
export default function LanBanner() {
  const { t } = useTranslation();
  const lan = isLanClient();
  const paired = lan && readLanToken() !== null;
  if (!lan) return null;

  const data = useCafeData();
  const { syncStatus, lastSyncedAt, dbError, refresh } = data;

  const forget = () => {
    clearLanToken();
    __resetDbForTests();
    window.location.reload();
  };

  const retry = () => {
    void refresh({ markStaleOnError: true });
  };

  const lastSyncedLabel = lastSyncedAt
    ? t("lan.lastSynced", {
        time: new Date(lastSyncedAt).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        }),
      })
    : null;

  if (!paired) {
    return (
      <div className="box warn" role="alert">
        <h3>{t("lan.unpairedTitle")}</h3>
        <p className="sub">{t("lan.unpairedBody")}</p>
      </div>
    );
  }

  const syncing =
    syncStatus === "connecting" ||
    syncStatus === "loading" ||
    syncStatus === "reconnecting";

  let bannerClass: string;
  let role: string;
  let status: ReactNode;

  if (syncing) {
    bannerClass = "notice ok lan-banner";
    role = "status";
    status = (
      <>
        <Smartphone size={16} aria-hidden />
        <span>{t("lan.syncing")}</span>
        {lastSyncedLabel && <p className="sub">{lastSyncedLabel}</p>}
      </>
    );
  } else if (syncStatus === "synchronized") {
    bannerClass = "notice ok lan-banner";
    role = "status";
    status = (
      <>
        <Smartphone size={16} aria-hidden />
        <span>
          <strong>{t("lan.phoneTitle")}</strong> — {t("lan.synced")}
        </span>
        {lastSyncedLabel && <p className="sub">{lastSyncedLabel}</p>}
      </>
    );
  } else if (syncStatus === "stale") {
    bannerClass = "notice warn lan-banner";
    role = "alert";
    status = (
      <>
        <Smartphone size={16} aria-hidden />
        <span>
          <strong>{t("lan.phoneTitle")}</strong> — {t("lan.stale")}
        </span>
        <p className="sub">
          {t("lan.lastSyncedStale", { time: lastSyncedLabel ?? "" })}
        </p>
        <button type="button" className="btn ghost" onClick={retry}>
          {t("lan.retry")}
        </button>
      </>
    );
  } else {
    // "failed": initial sync failed and no valid snapshot exists yet.
    bannerClass = "notice err lan-banner";
    role = "alert";
    status = (
      <>
        <Smartphone size={16} aria-hidden />
        <span>
          <strong>{t("lan.phoneTitle")}</strong> — {t("lan.failed")}
        </span>
        <p className="sub">{dbError ?? t("lan.error")}</p>
        <button type="button" className="btn ghost" onClick={retry}>
          {t("lan.retry")}
        </button>
      </>
    );
  }

  return (
    <div className={bannerClass} role={role}>
      {status}
      <div className="row2">
        <button type="button" className="btn ghost" onClick={forget}>
          {t("lan.forget")}
        </button>
      </div>
      {/* Visitor mode is read-only by design — state it plainly so the
          visitor does not hunt for a control that is intentionally absent. */}
      <p className="sub lan-readonly">{t("lan.phoneReadOnly")}</p>
    </div>
  );
}
