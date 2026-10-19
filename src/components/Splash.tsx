import { useTranslation } from "react-i18next";
import { EGO_LOGO_ALT, EGO_LOGO_SRC } from "../brand";

/** Branded opening sequence. Deliberate 3 s presentation, no fake progress %. */
export default function Splash() {
  const { t } = useTranslation();
  return (
    <div className="splash" role="status" aria-label={t("app.loading")}>
      <img
        src={EGO_LOGO_SRC}
        alt={EGO_LOGO_ALT}
        className="splash-logo"
        width={132}
        height={149}
        decoding="async"
      />
      <h1 className="splash-title">{t("app.name")}</h1>
      <p className="splash-sub">{t("app.tagline")}</p>
      <div className="splash-bar" aria-hidden />
    </div>
  );
}
