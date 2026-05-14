// app/[farmSlug]/admin/animals/[id]/_components/tabs.ts
// Tab descriptors + key types for the animal detail page. Bulls get an
// extra Progeny tab.

export const BASE_TABS = [
  { key: "overview",      label: "Overview" },
  { key: "reproduction",  label: "Reproduction" },
  { key: "health",        label: "Health" },
  { key: "movement",      label: "Movement" },
  { key: "weight",        label: "Weight & ADG" },
  { key: "investment",    label: "Investment" },
  { key: "photos",        label: "Photos" },
] as const;

export const PROGENY_TAB = { key: "progeny" as const, label: "Progeny" };

export type TabKey = typeof BASE_TABS[number]["key"] | "progeny";

/** Common JSON-details parser used across tabs. */
export function parseDetails(raw: string): Record<string, string> {
  try { return JSON.parse(raw); } catch { return {}; }
}
