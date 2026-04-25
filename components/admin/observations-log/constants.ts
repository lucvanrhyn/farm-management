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

export const TYPE_LABEL: Record<string, string> = {
  camp_check:      "Camp inspection",
  camp_condition:  "Camp condition",
  health_issue:    "Health",
  animal_movement: "Movement",
  reproduction:    "Reproduction",
  treatment:       "Treatment",
  death:           "Death",
  weighing:        "Weighing",
  calving:         "Calving",
  pregnancy_scan:  "Pregnancy Scan",
  heat:            "Heat / Oestrus",
  insemination:    "Insemination",
  lambing:         "Lambing",
  joining:         "Joining",
  shearing:        "Shearing",
  predation_loss:  "Predation Loss",
  dosing:          "Dosing",
  famacha:         "FAMACHA Score",
  fostering:       "Fostering",
  camp_cover:      "Cover Reading",
  mob_movement:    "Mob Movement",
};

export const TREATMENT_TYPES = ["Antibiotic", "Dip", "Deworming", "Vaccination", "Supplement", "Other"];
export const SYMPTOMS = ["Lame", "Thin", "Eye problem", "Wound", "Diarrhea", "Nasal discharge", "Bloated", "Not eating", "Other"];
export const SEVERITIES = ["mild", "moderate", "severe"];
export const GRAZING_QUALITY = ["Good", "Fair", "Poor", "Overgrazed"];
export const WATER_STATUS = ["Full", "Low", "Empty", "Broken"];
export const FENCE_STATUS = ["Intact", "Damaged"];
export const REPRODUCTION_EVENTS = ["heat", "insemination", "pregnancy_scan", "calving"];
export const DEATH_CAUSES = ["Unknown", "Redwater", "Heartwater", "Snake", "Old_age", "Birth_complications", "Other"];

/** Observation types whose details can be edited from the timeline modal. */
export const EDITABLE_TYPES = new Set([
  "weighing",
  "treatment",
  "health_issue",
  "camp_condition",
  "reproduction",
  "death",
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
