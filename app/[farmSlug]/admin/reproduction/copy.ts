// app/[farmSlug]/admin/reproduction/copy.ts
// Species-aware user-facing copy for the reproduction dashboard.
//
// Anika feedback (2026-04-19): sheep farmers were seeing "Calving" and
// "285-day gestation" on their reproduction page. This module is the single
// source of truth for species-specific labels so the page title, KPI labels,
// section headers, and empty-state copy all stay in lock-step.
//
// Kept as a separate module (not inline in page.tsx) because Next.js App
// Router forbids named exports from page files.

export type SpeciesMode = "cattle" | "sheep" | "game";

export interface ReproCopy {
  readonly pageTitle: string;
  /** "Calving" | "Lambing" | "Fawning" — sentence-initial / title case */
  readonly birthEvent: string;
  /** "calving" | "lambing" | "fawning" — mid-sentence */
  readonly birthEventLower: string;
  /** "calf" | "lamb" | "fawn" */
  readonly offspring: string;
  /** "calves" | "lambs" | "fawns" */
  readonly offspringPlural: string;
  /** "cow" | "ewe" | "doe" */
  readonly dam: string;
  /** Average gestation used for expected-birth date calculations (copy only). */
  readonly gestationDays: number;
  /** KPI card label, e.g. "Avg Calving Interval" / "Drop Rate" */
  readonly intervalLabel: string;
  /** KPI card label for weaning, e.g. "Weaning Rate" / "Lambs Weaned" */
  readonly weanedLabel: string;
  /** Empty-state hint telling the user where to log births. */
  readonly logHint: string;
  /** Short benchmark strip shown in the page sub-header. */
  readonly benchmarkLine: string;
}

export const COPY_BY_MODE: Record<SpeciesMode, ReproCopy> = {
  cattle: {
    pageTitle: "Reproductive Performance",
    birthEvent: "Calving",
    birthEventLower: "calving",
    offspring: "calf",
    offspringPlural: "calves",
    dam: "cow",
    gestationDays: 285,
    intervalLabel: "Avg Calving Interval",
    weanedLabel: "Weaning Rate",
    logHint: "Log calving events via Logger",
    benchmarkLine:
      "SA benchmarks: ≥85% pregnancy rate · ≤365d calving interval · >22% per 21-day cycle · <90d days open",
  },
  sheep: {
    pageTitle: "Reproductive Performance",
    birthEvent: "Lambing",
    birthEventLower: "lambing",
    offspring: "lamb",
    offspringPlural: "lambs",
    dam: "ewe",
    gestationDays: 150,
    intervalLabel: "Avg Lambing Interval",
    weanedLabel: "Lambs Weaned",
    logHint: "Log lambing events via Logger",
    benchmarkLine:
      "SA benchmarks: ≥130% lambing percentage · ≤8 month lambing interval · high multiples targeted",
  },
  game: {
    pageTitle: "Reproductive Performance",
    birthEvent: "Fawning",
    birthEventLower: "fawning",
    offspring: "fawn",
    offspringPlural: "fawns",
    dam: "doe",
    gestationDays: 210, // midpoint of common SA game species; used for copy only
    intervalLabel: "Drop Rate",
    weanedLabel: "Fawns Weaned",
    logHint: "Log fawning events via the Census tool",
    benchmarkLine:
      "Game benchmarks: target drop rate species-specific · track fawn survival by camp",
  },
};
