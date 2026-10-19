import { useTranslation } from "react-i18next";
import { Gamepad2 } from "lucide-react";

/** Branded opening sequence. Deliberate 3 s presentation, no fake progress %. */
export default function Splash() {
  const { t } = useTranslation();
  return (
    <div className="splash" role="status" aria-label={t("app.loading")}>
      <div className="splash-mark">
        <Gamepad2 size={44} aria-hidden />
      </div>
      <h1 className="splash-title">{t("app.name")}</h1>
      <p className="splash-sub">{t("app.tagline")}</p>
      <div className="splash-bar" aria-hidden />
    </div>
  );
}
