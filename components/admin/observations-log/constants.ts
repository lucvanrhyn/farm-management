// components/admin/observations-log/constants.ts
// Lookup tables, vocab arrays, and inline styles shared by all
// ObservationsLog subcomponents.

import type { ObservationType } from "@/lib/types";
import type { CSSProperties } from "react";

export const PAGE_SIZE = 50;

export const OBS_TYPES: { value: ObservationType | "all"; label: string }[] = [
  { value: "all",             label: "All types" },
  { value: "camp_check",      label: "Camp inspection" },
  { value: "camp_condition",  label: "Camp condition" },
  { value: "health_issue",    label: "Health" },
  { value: "animal_movement", label: "Movement" },
  { value: "reproduction",    label: "Reproduction" },
  { value: "treatment",       label: "Treatment" },
  { value: "death",           label: "Death" },
  { value: "weighing",        label: "Weighing" },
];

export const TYPE_BADGE: Record<string, { color: string; bg: string }> = {
  camp_check:      { color: "#5B9BD5", bg: "rgba(91,155,213,0.15)" },
  camp_condition:  { color: "#4AAFA0", bg: "rgba(74,175,160,0.15)" },
  health_issue:    { color: "#C0574C", bg: "rgba(192,87,76,0.15)" },
  animal_movement: { color: "#9B7ED4", bg: "rgba(155,126,212,0.15)" },
  reproduction:    { color: "#D47EB5", bg: "rgba(212,126,181,0.15)" },
  treatment:       { color: "#D4904A", bg: "rgba(212,144,74,0.15)" },
  death:           { color: "#9C8E7A", bg: "rgba(156,142,122,0.12)" },
  weighing:        { color: "#5BAD5E", bg: "rgba(91,173,94,0.15)" },
};

/**
 * @deprecated since #394 — prefer `getObservationTypeLabel(type)` from
 * `./registry.ts`. That helper is the authoritative source for label /
 * summary / detail-form across the admin timeline. This flat map is
 * retained for `app/[farmSlug]/sheep/observations/SheepObservationsTimeline.tsx`,
 * which is outside this wave's allow-list. The 9 persistence-canonical
 * types that used to be missing from this map are now filled in so the
 * legacy caller stays in sync with the registry until it migrates.
 *
 * If you find yourself reading this in a new feature, import from
 * `./registry` instead — every type is reachable via the exhaustive
 * `OBSERVATION_REGISTRY` mapped object type, and the structural arch
 * test (`tests/arch/observation-registry-coverage.test.ts`) catches a
 * missing entry at CI rather than at runtime in the UI.
 */
export const TYPE_LABEL: Record<string, string> = {
  camp_check:            "Camp Inspection",
  camp_condition:        "Camp Condition",
  health_issue:          "Health",
  animal_movement:       "Movement",
  reproduction:          "Reproduction",
  treatment:             "Treatment",
  death:                 "Death",
  weighing:              "Weighing",
  calving:               "Calving",
  pregnancy_scan:        "Pregnancy Scan",
  heat:                  "Heat / Oestrus",
  heat_detection:        "Heat Detection",
  insemination:          "Insemination",
  lambing:               "Lambing",
  joining:               "Joining",
  shearing:              "Shearing",
  predation_loss:        "Predation Loss",
  dosing:                "Dosing",
  famacha:               "FAMACHA Score",
  fostering:             "Fostering",
  camp_cover:            "Cover Reading",
  mob_movement:          "Mob Movement",
  // #394 — fill the 9 persistence-canonical types that used to fall
  // through the legacy TYPE_LABEL lookup. The registry is authoritative;
  // this list exists only for the SheepObservationsTimeline caller.
  body_condition_score:  "Body Condition Score",
  temperament_score:     "Temperament Score",
  scrotal_circumference: "Scrotal Circumference",
  drying_off:            "Drying Off",
  weaning:               "Weaning",
  general:               "General Note",
  game_census:           "Game Census",
  game_sighting:         "Game Sighting",
};

export const TREATMENT_TYPES = ["Antibiotic", "Dip", "Deworming", "Vaccination", "Supplement", "Other"];
export const SYMPTOMS = ["Lame", "Thin", "Eye problem", "Wound", "Diarrhea", "Nasal discharge", "Bloated", "Not eating", "Other"];
export const SEVERITIES = ["mild", "moderate", "severe"];
export const GRAZING_QUALITY = ["Good", "Fair", "Poor", "Overgrazed"];
export const WATER_STATUS = ["Full", "Low", "Empty", "Broken"];
export const FENCE_STATUS = ["Intact", "Damaged"];
export const REPRODUCTION_EVENTS = ["heat", "insemination", "pregnancy_scan", "calving"];
export const DEATH_CAUSES = ["Unknown", "Redwater", "Heartwater", "Snake", "Old_age", "Birth_complications", "Other"];

/**
 * @deprecated since #394 — prefer `isObservationEditable(type)` from
 * `./registry.ts`. The registry derives editability from the per-type
 * `editable: boolean` flag, kept consistent with the form components
 * it dispatches.
 *
 * Retained for any out-of-tree caller (none in the repo as of #394, but
 * the constant is part of the historical public surface of this
 * directory).
 */
export const EDITABLE_TYPES = new Set([
  "weighing",
  "treatment",
  "health_issue",
  "camp_condition",
  "reproduction",
  "death",
  // #394 — newly editable types after the registry-driven dispatch.
  "body_condition_score",
  "temperament_score",
  "scrotal_circumference",
  "dosing",
  "general",
]);

export const lightSelect: CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid #E0D5C8",
  color: "#1C1815",
  borderRadius: "0.75rem",
  padding: "0.375rem 0.75rem",
  fontSize: "0.875rem",
  outline: "none",
};

export const fieldInput: CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid #E0D5C8",
  color: "#1C1815",
  borderRadius: "0.75rem",
  padding: "0.5rem 0.75rem",
  fontSize: "0.875rem",
  outline: "none",
  width: "100%",
};
