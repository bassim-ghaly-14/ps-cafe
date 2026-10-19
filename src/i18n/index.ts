import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ar from "./locales/ar/translation.json";

export const SUPPORTED_LANGS = ["ar"] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];
export const DEFAULT_LANG: SupportedLang = "ar";

export const resources = { ar: { translation: ar } } as const;

// Resolves once i18n initialization completes. Used by main.tsx and tests so the
// Arabic locale, RTL, and translations are all ready before first paint.
export const readyPromise = i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LANG,
  fallbackLng: DEFAULT_LANG,
  supportedLngs: [...SUPPORTED_LANGS],
  defaultNS: "translation",
  nsSeparator: false,
  keySeparator: ".",
  interpolation: { escapeValue: false },
  returnEmptyString: false,
});
export function applyDocumentLocale(lang: SupportedLang): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }
}

applyDocumentLocale(DEFAULT_LANG);

export default i18n;
