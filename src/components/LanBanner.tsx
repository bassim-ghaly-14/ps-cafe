import { useTranslation } from "react-i18next";
import { Smartphone } from "lucide-react";
import { clearLanToken, readLanToken } from "../db/http";
import { __resetDbForTests, isLanClient } from "../db/client";

/**
 * Phone-client chrome. Desktop renders nothing. On a paired phone this
 * shows a compact banner (connection state + forget-pairing); when no
 * token is present it explains how to pair instead of failing silently
 * at the first database call.
 */
export default function LanBanner() {
  const { t } = useTranslation();
  const lan = isLanClient();
  const paired = lan && readLanToken() !== null;
  if (!lan) return null;

  const forget = () => {
    clearLanToken();
    __resetDbForTests();
    window.location.reload();
  };

  if (!paired) {
    return (
      <div className="box warn" role="alert">
        <h3>{t("lan.unpairedTitle")}</h3>
        <p className="sub">{t("lan.unpairedBody")}</p>
      </div>
    );
  }

  return (
    <div className="notice ok lan-banner" role="status">
      <Smartphone size={16} aria-hidden />
      <span>
        <strong>{t("lan.phoneTitle")}</strong> — {t("lan.phoneBody")}
      </span>
      <div className="row2">
        <button type="button" className="btn ghost" onClick={forget}>
          {t("lan.forget")}
        </button>
      </div>
    </div>
  );
}
