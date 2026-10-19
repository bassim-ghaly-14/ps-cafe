export const ACTIVE_TAB_KEY = "pscafe.activeTab";
export const MIN_SPLASH_MS = 3000;
export type { ActiveTab } from "./domain/types";

const VALID_TABS = new Set(["day", "stations", "settings"]);

export function parseActiveTab(
  raw: string | null,
): "day" | "stations" | "settings" {
  if (raw !== null && VALID_TABS.has(raw))
    return raw as "day" | "stations" | "settings";
  return "day";
}
