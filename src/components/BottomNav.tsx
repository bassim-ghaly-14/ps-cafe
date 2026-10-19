import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { CalendarDays, Gamepad2, Settings } from "lucide-react";
import type { ActiveTab } from "../domain/types";

interface Props {
  active: ActiveTab;
  onChange: (tab: ActiveTab) => void;
}

const ITEMS: { key: ActiveTab; labelKey: string; Icon: typeof CalendarDays }[] =
  [
    { key: "day", labelKey: "nav.day", Icon: CalendarDays },
    { key: "stations", labelKey: "nav.stations", Icon: Gamepad2 },
    { key: "settings", labelKey: "nav.settings", Icon: Settings },
  ];

/** Persistent bottom navigation (app nav, not a footer). RTL-aware. */
export default function BottomNav({ active, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <nav className="bottom-nav" aria-label={t("nav.primary")}>
      {ITEMS.map(({ key, labelKey, Icon }) => (
        <button
          key={key}
          type="button"
          className={active === key ? "nav-item active" : "nav-item"}
          aria-current={active === key ? "page" : undefined}
          onClick={() => onChange(key)}
        >
          <Icon size={20} aria-hidden />
          <span>{t(labelKey)}</span>
        </button>
      ))}
    </nav>
  );
}

export function useActiveTabState(initial: ActiveTab) {
  const [tab, setTab] = useState<ActiveTab>(initial);
  useEffect(() => {
    try {
      localStorage.setItem("pscafe.activeTab", tab);
    } catch {
      /* private mode — tab simply won't persist */
    }
  }, [tab]);
  return [tab, setTab] as const;
}
