// components/admin/observations-log/registry.ts
//
// Issue #394 (PRD #389 W5) — single source of truth for the admin
// observation timeline's label / summary / editor per type.
//
// Before W5, three independent structures described each observation
// type:
//
//   - `TYPE_LABEL` in `constants.ts` (human label)
//   - `parseDetails` switch in `parseDetails.ts` (summary line)
//   - `TypeFields` switch in `fields.tsx` (per-type editor form)
//
// They drifted. Nine persistence-canonical types
// (`scrotal_circumference`, `body_condition_score`, `temperament_score`,
// `heat_detection`, `drying_off`, `weaning`, `general`, `game_census`,
// `game_sighting`) were missing from at least one, so the admin timeline
// rendered raw enum identifiers (`SCROTAL_CIRCUMFERENCE`) and the
// `"Details recorded"` generic fallback.
//
// W5 unifies the three into `OBSERVATION_REGISTRY` keyed by the
// persistence-canonical observation type list
// (`OBSERVATION_TYPE_LIST` in `lib/domain/observations/registry.ts`).
//
// Structural lock
// ───────────────
//   The mapped object type `{ [T in ObservationType]: RegistryEntry }`
//   forces a compile error if any type is missing.
//   `tests/arch/observation-registry-coverage.test.ts` is the runtime
//   half — it iterates `OBSERVATION_TYPE_LIST` at runtime and asserts a
//   non-empty label + parser + form per type.
//
// Adding a new observation type
// ─────────────────────────────
//   1. Add the string literal to `OBSERVATION_TYPE_LIST` in
//      `lib/domain/observations/registry.ts`.
//   2. Add a registry entry below. TypeScript will refuse to compile
//      until you do; the arch test will refuse to pass until you do.
//   3. There is NO `"Details recorded"` fallback path. The previous
//      generic was a silent UI failure; the registry is exhaustive by
//      construction.

"use client";

import React from "react";
import type { ComponentType, ReactNode } from "react";

import {
  type ObservationType,
  OBSERVATION_TYPE_LIST,
} from "@/lib/domain/observations/registry";

import {
  CampConditionFields,
  DeathFields,
  HealthIssueFields,
  ReadOnlyDetails,
  ReproductionFields,
  TreatmentFields,
  WeighingFields,
  type FieldProps,
} from "./fields";

// ── Small helpers ───────────────────────────────────────────────────────────

function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function pick(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return undefined;
}

// ── Numeric-only field component (reused for score / measurement inputs) ────

interface NumericFieldConfig {
  storageKey: string;
  altKeys?: readonly string[];
  label: string;
  step?: string;
  min?: number;
  max?: number;
  unit?: string;
}

function makeNumericFieldComponent(
  cfg: NumericFieldConfig,
): ComponentType<FieldProps> {
  const Component = ({ details, onChange }: FieldProps) => {
    const current =
      details[cfg.storageKey] ??
      (cfg.altKeys ?? []).map((k) => details[k]).find((v) => v !== undefined);
    return (
      <div className="flex flex-col gap-3">
        <label className="text-xs font-semibold" style={{ color: "#6B5C4E" }}>
          {cfg.label}
          {cfg.unit ? ` (${cfg.unit})` : ""}
          <input
            type="number"
            step={cfg.step ?? "1"}
            min={cfg.min}
            max={cfg.max}
            value={
              current === undefined || current === null ? "" : String(current)
            }
            onChange={(e) =>
              onChange(
                cfg.storageKey,
                e.target.value === "" ? "" : Number(e.target.value),
              )
            }
            style={{
              background: "#FFFFFF",
              border: "1px solid #E0D5C8",
              color: "#1C1815",
              borderRadius: "0.75rem",
              padding: "0.5rem 0.75rem",
              fontSize: "0.875rem",
              outline: "none",
              width: "100%",
            }}
            className="mt-1 block"
          />
        </label>
      </div>
    );
  };
  Component.displayName = `NumericField(${cfg.storageKey})`;
  return Component;
}

// ── Registry entry shape ────────────────────────────────────────────────────

/**
 * One presentation entry per `ObservationType`. The mapped object type
 * `{ [T in ObservationType]: RegistryEntry }` lower down is the
 * compile-time lock — adding a new type to `OBSERVATION_TYPE_LIST`
 * forces a new entry here.
 */
export interface RegistryEntry {
  /** Human-readable label shown in timeline badge + edit-modal header. */
  label: string;
  /**
   * Pure function turning a stored JSON `details` string into a one-line
   * human summary for the timeline row. Tolerates camelCase /
   * snake_case (the Logger and importers have historically used both).
   */
  parseDetails: (rawDetails: string) => string;
  /**
   * React component rendering the edit-modal's per-type form. Receives
   * the parsed details object plus an onChange callback. Read-only
   * types use `ReadOnlyDetails`.
   */
  detailsForm: ComponentType<FieldProps>;
  /** Whether the modal exposes a Save button. False ⇒ read-only viewer. */
  editable: boolean;
}

// ── Per-type parsers ────────────────────────────────────────────────────────
// Kept small and side-effect-free; each receives the parsed details object
// and returns a renderable string. Test in
// `components/admin/observations-log/__tests__/registry.test.ts`.

const parseCampCheck = (o: Record<string, unknown>): string => {
  const status = pick(o, "status", "outcome") ?? "Normal";
  return `Status: ${status}`;
};

const parseCampCondition = (o: Record<string, unknown>): string => {
  const grazing = pick(o, "grazingQuality", "grazing_quality", "grazing");
  const water = pick(o, "waterStatus", "water_status", "water");
  const fence = pick(o, "fenceStatus", "fence_status", "fence");
  const parts: string[] = [];
  if (grazing) parts.push(`Grazing: ${grazing}`);
  if (water) parts.push(`Water: ${water}`);
  if (fence) parts.push(`Fence: ${fence}`);
  return parts.join(" · ") || "Camp condition recorded";
};

const parseAnimalMovement = (o: Record<string, unknown>): string => {
  const animalId = pick(o, "animalId", "animal_id", "mobId", "mob_id") ?? "?";
  const src = pick(o, "sourceCampId", "source_camp_id", "from_camp", "fromCamp");
  const dest = pick(o, "destCampId", "dest_camp_id", "to_camp", "toCamp") ?? "?";
  return src
    ? `🔄 ${animalId} moved: ${src} → ${dest}`
    : `🔄 Moved to Camp ${dest}`;
};

const parseMobMovement = (o: Record<string, unknown>): string => {
  const mobId = pick(o, "mobId", "mob_id", "animalId", "animal_id") ?? "?";
  const src = pick(o, "sourceCampId", "source_camp_id", "from_camp", "fromCamp");
  const dest = pick(o, "destCampId", "dest_camp_id", "to_camp", "toCamp") ?? "?";
  return src
    ? `🔄 Mob ${mobId} moved: ${src} → ${dest}`
    : `🔄 Mob moved to Camp ${dest}`;
};

const parseCalving = (o: Record<string, unknown>): string => {
  const outcome = pick(o, "outcome", "calf_status", "ease_of_birth");
  const sex = pick(o, "calfSex", "sex", "calf_sex");
  const calfId = pick(o, "calfAnimalId", "calf_animal_id", "calf_id", "calf_tag");
  const twinCount = pick(o, "twin_count", "twinCount");
  const parts: string[] = [];
  if (outcome) parts.push(outcome);
  if (twinCount) parts.push(`Twins: ${twinCount}`);
  if (sex) parts.push(`Sex: ${sex}`);
  if (calfId) parts.push(`Calf: ${calfId}`);
  return parts.length ? `👶 Calving — ${parts.join(" · ")}` : "👶 Calving recorded";
};

const parseLambing = (o: Record<string, unknown>): string => {
  const outcome = pick(o, "outcome", "calf_status", "ease_of_birth");
  const sex = pick(o, "calfSex", "sex", "calf_sex");
  const lambId = pick(o, "calfAnimalId", "calf_animal_id", "calf_id", "calf_tag");
  const twinCount = pick(o, "twin_count", "twinCount", "lambs_born", "lambsBorn");
  const parts: string[] = [];
  if (outcome) parts.push(outcome);
  if (twinCount) parts.push(`Twins: ${twinCount}`);
  if (sex) parts.push(`Sex: ${sex}`);
  if (lambId) parts.push(`Lamb: ${lambId}`);
  return parts.length ? `👶 Lambing — ${parts.join(" · ")}` : "👶 Lambing recorded";
};

const parsePregnancyScan = (o: Record<string, unknown>): string => {
  const result = pick(o, "result", "outcome") ?? "recorded";
  const scanner = pick(o, "scanner_name", "scannerName", "scanner", "veterinarian");
  return scanner
    ? `🤰 Pregnancy scan — ${result} — Scanner: ${scanner}`
    : `🤰 Pregnancy scan — ${result}`;
};

const parseHeatDetection = (o: Record<string, unknown>): string => {
  const intensity = pick(o, "intensity", "method", "strength") ?? "observed";
  return `❤️ Heat detected — ${intensity}`;
};

const parseInsemination = (o: Record<string, unknown>): string => {
  const method = pick(o, "method") ?? "Service";
  const sire = pick(o, "sire_id", "sireId", "bullId", "bull_id", "ramId", "ram_id");
  return sire ? `💉 ${method} — Sire: ${sire}` : `💉 ${method}`;
};

const parseWeighing = (o: Record<string, unknown>): string => {
  const weight = pick(o, "weight_kg", "weightKg", "weight");
  const method = pick(o, "method", "scale");
  if (!weight) return "⚖️ Weighing recorded";
  return method ? `⚖️ ${weight} kg — Method: ${method}` : `⚖️ ${weight} kg`;
};

const parseTreatment = (o: Record<string, unknown>): string => {
  const kind = pick(o, "treatmentType", "treatment_type", "type");
  const product = pick(o, "product", "drug", "medicine");
  const withdrawal = pick(o, "withdrawalDays", "withdrawal_days");
  const parts: string[] = [];
  if (kind) parts.push(kind);
  if (product) parts.push(`Product: ${product}`);
  if (withdrawal) parts.push(`Withdrawal: ${withdrawal}d`);
  return parts.length ? `💊 ${parts.join(" — ")}` : "💊 Treatment recorded";
};

const parseDosing = (o: Record<string, unknown>): string => {
  // Same wire shape as treatment; different emoji + verb.
  const product = pick(o, "product", "drug", "medicine");
  const dose = pick(o, "dose", "amount");
  const withdrawal = pick(o, "withdrawalDays", "withdrawal_days");
  const parts: string[] = [];
  if (product) parts.push(product);
  if (dose) parts.push(`Dose: ${dose}`);
  if (withdrawal) parts.push(`Withdrawal: ${withdrawal}d`);
  return parts.length ? `💉 Dosed — ${parts.join(" · ")}` : "💉 Dosed";
};

const parseHealthIssue = (o: Record<string, unknown>): string => {
  const issue =
    pick(o, "issue_type", "issueType", "symptom") ??
    (Array.isArray(o.symptoms) ? (o.symptoms as string[]).join(", ") : undefined) ??
    "Issue";
  const severity = pick(o, "severity");
  return severity
    ? `🩺 ${issue} — Severity: ${severity}`
    : `🩺 ${issue}`;
};

const parseDeath = (o: Record<string, unknown>): string => {
  const cause = pick(o, "cause") ?? "unknown";
  return `Cause: ${cause}`;
};

const parseShearing = (o: Record<string, unknown>): string => {
  const wool = pick(o, "wool_kg", "woolKg", "clip_kg", "clipKg");
  return wool ? `✂️ Shorn — Clip: ${wool} kg` : "✂️ Shorn";
};

const parseReproduction = (o: Record<string, unknown>): string => {
  const event = pick(o, "eventType", "event_type", "event");
  return event ? `Event: ${event}` : "Reproduction event";
};

// ── #394 — formerly-uncovered parsers ───────────────────────────────────────

const BCS_DESCRIPTIONS: Record<number, string> = {
  1: "Emaciated", 2: "Very thin", 3: "Thin",
  4: "Borderline", 5: "Moderate", 6: "Good",
  7: "Fleshy", 8: "Obese", 9: "Very obese",
};

const TEMPERAMENT_DESCRIPTIONS: Record<number, string> = {
  1: "Docile", 2: "Slightly restless", 3: "Restless",
  4: "Nervous", 5: "Flighty",
};

const parseBodyConditionScore = (o: Record<string, unknown>): string => {
  const raw = pick(o, "score", "bcs", "bcsScore");
  if (!raw) return "📊 BCS recorded";
  const n = Number(raw);
  const desc = Number.isFinite(n) ? BCS_DESCRIPTIONS[Math.round(n)] : undefined;
  return desc ? `📊 BCS: ${raw}/9 (${desc})` : `📊 BCS: ${raw}/9`;
};

const parseTemperamentScore = (o: Record<string, unknown>): string => {
  const raw = pick(o, "score", "temperament");
  if (!raw) return "🧠 Temperament recorded";
  const n = Number(raw);
  const desc = Number.isFinite(n) ? TEMPERAMENT_DESCRIPTIONS[Math.round(n)] : undefined;
  return desc ? `🧠 Temperament: ${raw}/5 (${desc})` : `🧠 Temperament: ${raw}/5`;
};

const parseScrotalCircumference = (o: Record<string, unknown>): string => {
  const cm = pick(o, "measurement_cm", "measurementCm", "scrotal_cm", "scrotalCm");
  if (cm) return `📏 Scrotal: ${cm} cm`;
  // Some legacy importers used `mm`. Render with the unit the data carries.
  const mm = pick(o, "measurement_mm", "measurementMm");
  if (mm) return `📏 Scrotal: ${mm} mm`;
  return "📏 Scrotal circumference recorded";
};

const parseDryingOff = (o: Record<string, unknown>): string => {
  const date = pick(o, "date", "dried_off_at", "driedOffAt");
  return date ? `🥛 Drying off — ${date}` : "🥛 Drying off recorded";
};

const parseWeaning = (o: Record<string, unknown>): string => {
  const weight = pick(o, "weight_kg", "weightKg", "weaning_weight_kg");
  const date = pick(o, "date", "weaned_at", "weanedAt");
  const parts: string[] = [];
  if (weight) parts.push(`${weight} kg`);
  if (date) parts.push(date);
  return parts.length ? `🐄 Weaning — ${parts.join(" · ")}` : "🐄 Weaning recorded";
};

const parseGeneral = (o: Record<string, unknown>): string => {
  const note = pick(o, "note", "notes", "description", "text");
  return note ? `📝 ${note}` : "📝 Note recorded";
};

const parseGameCensus = (o: Record<string, unknown>): string => {
  const species = pick(o, "species", "game_species", "animal_species");
  const count = pick(o, "count", "head", "animals", "total");
  const parts: string[] = [];
  if (species) parts.push(`Species: ${species}`);
  if (count) parts.push(`Count: ${count}`);
  return parts.length ? `🦌 Census — ${parts.join(" · ")}` : "🦌 Census recorded";
};

const parseGameSighting = (o: Record<string, unknown>): string => {
  const species = pick(o, "species", "game_species", "animal_species");
  const count = pick(o, "count", "head", "animals", "total");
  const parts: string[] = [];
  if (species) parts.push(`Species: ${species}`);
  if (count) parts.push(`Count: ${count}`);
  return parts.length ? `🔭 Sighting — ${parts.join(" · ")}` : "🔭 Sighting recorded";
};

// ── Form components for the new types ───────────────────────────────────────

const BodyConditionScoreForm = makeNumericFieldComponent({
  storageKey: "score",
  altKeys: ["bcs", "bcsScore"],
  label: "BCS Score *",
  min: 1,
  max: 9,
});

const TemperamentScoreForm = makeNumericFieldComponent({
  storageKey: "score",
  altKeys: ["temperament"],
  label: "Temperament Score *",
  min: 1,
  max: 5,
});

const ScrotalCircumferenceForm = makeNumericFieldComponent({
  storageKey: "measurement_cm",
  altKeys: ["measurementCm", "scrotal_cm", "scrotalCm"],
  label: "Scrotal Circumference",
  step: "0.1",
  unit: "cm",
});

const GeneralNoteForm = ({ details, onChange }: FieldProps) => (
  <div className="flex flex-col gap-3">
    <label className="text-xs font-semibold" style={{ color: "#6B5C4E" }}>
      Note
      <textarea
        value={
          (details.note as string) ??
          (details.notes as string) ??
          (details.description as string) ??
          ""
        }
        onChange={(e) => onChange("note", e.target.value)}
        rows={4}
        style={{
          background: "#FFFFFF",
          border: "1px solid #E0D5C8",
          color: "#1C1815",
          borderRadius: "0.75rem",
          padding: "0.5rem 0.75rem",
          fontSize: "0.875rem",
          outline: "none",
          width: "100%",
          resize: "vertical",
        }}
        className="mt-1 block"
      />
    </label>
  </div>
);
GeneralNoteForm.displayName = "GeneralNoteForm";

// ── Wire raw parser tags onto the per-type form so the timeline does
//     not need a parallel switch. Each entry is exhaustive.
// ───────────────────────────────────────────────────────────────────────────

/**
 * `OBSERVATION_REGISTRY` is the **only** source of truth for
 * label + summary + editor across the admin timeline. Adding a new key
 * to `OBSERVATION_TYPE_LIST` forces a new entry here (compile error
 * from the mapped type) and surfaces in the arch-test runtime check.
 */
export const OBSERVATION_REGISTRY: { readonly [T in ObservationType]: RegistryEntry } = {
  // ── Camp-level ──
  camp_check: {
    label: "Camp Inspection",
    parseDetails: (raw) => parseCampCheck(safeParse(raw)),
    detailsForm: ReadOnlyDetails as ComponentType<FieldProps>,
    editable: false,
  },
  camp_condition: {
    label: "Camp Condition",
    parseDetails: (raw) => parseCampCondition(safeParse(raw)),
    detailsForm: CampConditionFields,
    editable: true,
  },

  // ── Movement ──
  animal_movement: {
    label: "Movement",
    parseDetails: (raw) => parseAnimalMovement(safeParse(raw)),
    detailsForm: ReadOnlyDetails as ComponentType<FieldProps>,
    editable: false,
  },
  mob_movement: {
    label: "Mob Movement",
    parseDetails: (raw) => parseMobMovement(safeParse(raw)),
    detailsForm: ReadOnlyDetails as ComponentType<FieldProps>,
    editable: false,
  },

  // ── Reproduction sub-flows ──
  calving: {
    label: "Calving",
    parseDetails: (raw) => parseCalving(safeParse(raw)),
    detailsForm: ReadOnlyDetails as ComponentType<FieldProps>,
    editable: false,
  },
  lambing: {
    label: "Lambing",
    parseDetails: (raw) => parseLambing(safeParse(raw)),
    detailsForm: ReadOnlyDetails as ComponentType<FieldProps>,
    editable: false,
  },
  pregnancy_scan: {
    label: "Pregnancy Scan",
    parseDetails: (raw) => parsePregnancyScan(safeParse(raw)),
    detailsForm: ReadOnlyDetails as ComponentType<FieldProps>,
    editable: false,
  },
  heat_detection: {
    label: "Heat Detection",
    parseDetails: (raw) => parseHeatDetection(safeParse(raw)),
    detailsForm: ReadOnlyDetails as ComponentType<FieldProps>,
    editable: false,
  },
  insemination: {
    label: "Insemination",
    parseDetails: (raw) => parseInsemination(safeParse(raw)),
    detailsForm: ReadOnlyDetails as ComponentType<FieldProps>,
    editable: false,
  },
  body_condition_score: {
    label: "Body Condition Score",
    parseDetails: (raw) => parseBodyConditionScore(safeParse(raw)),
    detailsForm: BodyConditionScoreForm,
    editable: true,
  },
  temperament_score: {
    label: "Temperament Score",
    parseDetails: (raw) => parseTemperamentScore(safeParse(raw)),
    detailsForm: TemperamentScoreForm,
    editable: true,
  },
  scrotal_circumference: {
    label: "Scrotal Circumference",
    parseDetails: (raw) => parseScrotalCircumference(safeParse(raw)),
    detailsForm: ScrotalCircumferenceForm,
    editable: true,
  },
  drying_off: {
    label: "Drying Off",
    parseDetails: (raw) => parseDryingOff(safeParse(raw)),
    detailsForm: ReadOnlyDetails as ComponentType<FieldProps>,
    editable: false,
  },
  weaning: {
    label: "Weaning",
    parseDetails: (raw) => parseWeaning(safeParse(raw)),
    detailsForm: ReadOnlyDetails as ComponentType<FieldProps>,
    editable: false,
  },

  // ── Husbandry ──
  weighing: {
    label: "Weighing",
    parseDetails: (raw) => parseWeighing(safeParse(raw)),
    detailsForm: WeighingFields,
    editable: true,
  },
  treatment: {
    label: "Treatment",
    parseDetails: (raw) => parseTreatment(safeParse(raw)),
    detailsForm: TreatmentFields,
    editable: true,
  },
  dosing: {
    label: "Dosing",
    parseDetails: (raw) => parseDosing(safeParse(raw)),
    detailsForm: TreatmentFields,
    editable: true,
  },
  health_issue: {
    label: "Health",
    parseDetails: (raw) => parseHealthIssue(safeParse(raw)),
    detailsForm: HealthIssueFields,
    editable: true,
  },
  death: {
    label: "Death",
    parseDetails: (raw) => parseDeath(safeParse(raw)),
    detailsForm: DeathFields,
    editable: true,
  },
  shearing: {
    label: "Shearing",
    parseDetails: (raw) => parseShearing(safeParse(raw)),
    detailsForm: ReadOnlyDetails as ComponentType<FieldProps>,
    editable: false,
  },

  // ── Misc ──
  general: {
    label: "General Note",
    parseDetails: (raw) => parseGeneral(safeParse(raw)),
    detailsForm: GeneralNoteForm,
    editable: true,
  },

  // ── Game ──
  game_census: {
    label: "Game Census",
    parseDetails: (raw) => parseGameCensus(safeParse(raw)),
    detailsForm: ReadOnlyDetails as ComponentType<FieldProps>,
    editable: false,
  },
  game_sighting: {
    label: "Game Sighting",
    parseDetails: (raw) => parseGameSighting(safeParse(raw)),
    detailsForm: ReadOnlyDetails as ComponentType<FieldProps>,
    editable: false,
  },
};

/**
 * Legacy / non-persistence-canonical observation types that still surface
 * in the admin timeline from historical tenant data or the legacy
 * `lib/types.ts` UI union. These keys are NOT in
 * `OBSERVATION_TYPE_LIST`, so the mapped-type structural lock excludes
 * them. They live here so the timeline + EditModal can still resolve a
 * label / summary / form without falling back to the dead
 * `"Details recorded"` placeholder.
 *
 * Adding a new persistence-canonical type goes in `OBSERVATION_REGISTRY`
 * above. Only put a type here if it is genuinely historical and cannot
 * be promoted into the canonical list (e.g. it has no `createObservation`
 * write path).
 */
export const LEGACY_OBSERVATION_REGISTRY: Readonly<Record<string, RegistryEntry>> = {
  reproduction: {
    label: "Reproduction",
    parseDetails: (raw) => parseReproduction(safeParse(raw)),
    detailsForm: ReproductionFields,
    editable: true,
  },
};

// ── Public helpers ──────────────────────────────────────────────────────────

/**
 * Look up a registry entry by raw type string. Checks the canonical
 * `OBSERVATION_REGISTRY` first, then falls back to
 * `LEGACY_OBSERVATION_REGISTRY` for historical types not in the
 * persistence allowlist. Returns `undefined` for genuinely unknown
 * types.
 */
function lookupEntry(type: string): RegistryEntry | undefined {
  const canonical = (OBSERVATION_REGISTRY as Record<string, RegistryEntry | undefined>)[type];
  if (canonical) return canonical;
  return LEGACY_OBSERVATION_REGISTRY[type];
}

/**
 * Friendly label for the type badge. Returns the raw type string for
 * any value not in either registry — that path is locked closed by the
 * arch test for canonical types, so it only fires for unknown legacy
 * data (where the raw identifier IS the most useful UI signal).
 */
export function getObservationTypeLabel(type: string): string {
  const entry = lookupEntry(type);
  return entry?.label ?? type;
}

/**
 * One-line summary for the timeline row. Returns a sensible last-resort
 * key/value sweep for any unknown legacy type rather than re-introducing
 * the `"Details recorded"` placeholder.
 */
export function parseObservationDetails(type: string, raw: string): string {
  const entry = lookupEntry(type);
  if (entry) return entry.parseDetails(raw);
  // Fallback for legacy types not in the canonical list — summarise any
  // recognisable keys but never emit the dead "Details recorded" string.
  const obj = safeParse(raw);
  const parts: string[] = [];
  const weight = pick(obj, "weight_kg", "weightKg");
  if (weight) parts.push(`Weight: ${weight}kg`);
  if (Array.isArray(obj.symptoms)) {
    parts.push(`Symptoms: ${(obj.symptoms as string[]).join(", ")}`);
  } else if (typeof obj.symptoms === "string") {
    parts.push(`Symptoms: ${obj.symptoms}`);
  }
  const severity = pick(obj, "severity");
  if (severity) parts.push(`Severity: ${severity}`);
  const product = pick(obj, "product");
  if (product) parts.push(`Product: ${product}`);
  if (parts.length) return parts.join(" · ");
  // Sweep any non-empty primitive into a fallback key/value line.
  const entries = Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
  if (entries.length) return entries.join(" · ");
  return `${type.replace(/_/g, " ")} recorded`;
}

/**
 * The detail-form component for a given type, used by `EditModal`.
 * Returns `ReadOnlyDetails` for unknown legacy types.
 */
export function getObservationDetailsForm(type: string): ComponentType<FieldProps> {
  const entry = lookupEntry(type);
  return (entry?.detailsForm ?? ReadOnlyDetails) as ComponentType<FieldProps>;
}

/** Whether the modal exposes Save (true) or is read-only (false). */
export function isObservationEditable(type: string): boolean {
  const entry = lookupEntry(type);
  return Boolean(entry?.editable);
}

// Re-export the canonical list for callers that want to iterate without
// pulling in the persistence module directly. Read-only — mutating it
// is a programming error.
export { OBSERVATION_TYPE_LIST };
export type { ObservationType };

// `React` and `ReactNode` are imported above for the JSX in the form
// components; surface to callers without forcing them to import twice.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ReactNodeReExport = ReactNode;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ReactReExport = typeof React;
