/**
 * lib/server/triage/snapshot-detectors.ts — PURE per-animal attribute
 * detectors for Herd Triage v1.
 *
 * "Snapshot" = computable from the Animal row ALONE (no observation history,
 * no clock-relative thresholds beyond age). Every function here is pure and
 * total: same input → same Findings, no I/O. The orchestrator
 * (`get-triage.ts`) fetches the rows once and feeds them in.
 *
 * The ONE exception to "Animal-row-alone" is `detectNoWeightOnRecord`: a
 * weighing is an Observation, not an Animal column, so it takes a precomputed
 * `Set<animalId>` of animals that have any weighing on record. It SUPPRESSES
 * the reason entirely when that set is empty, so a day-1 import (nobody
 * weighed yet) reads "this animal is behind" — never "nobody is weighed".
 */

import type { Finding } from "./types";
import type { SpeciesId } from "@/lib/species/types";

/**
 * The minimal Animal projection the snapshot detectors need. Identity is the
 * business key `animalId` (Animal.animalId @unique) — the SAME key the
 * history detectors (dosing-overdue, in-withdrawal, poor-doer) project, so
 * findings from every source group cleanly per animal in `project.ts`.
 */
export interface TriageAnimal {
  animalId: string;
  species: SpeciesId;
  currentCamp: string;
  tagNumber: string | null;
  brandSequence: string | null;
  dateOfBirth: string | null;
  category: string;
}

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/**
 * Sentinel camp tokens that mean "no real camp" alongside empty string. The
 * canonical representation in this codebase is the empty string (see
 * `lib/server/data-health.ts` → `currentCamp: { not: "" }`); the extra tokens
 * defend against imports that wrote a placeholder instead of leaving it blank.
 */
const NO_CAMP_SENTINELS = new Set(["unassigned", "none", "-", "n/a", "na"]);

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim().length === 0;
}

function makeFinding(animal: TriageAnimal, reasonId: string): Finding {
  return { animalId: animal.animalId, reasonId, species: animal.species };
}

/** no-camp: currentCamp is blank/whitespace OR a no-camp sentinel token. */
export function detectNoCamp(animals: readonly TriageAnimal[]): Finding[] {
  const out: Finding[] = [];
  for (const a of animals) {
    if (isBlank(a.currentCamp) || NO_CAMP_SENTINELS.has(a.currentCamp.trim().toLowerCase())) {
      out.push(makeFinding(a, "no-camp"));
    }
  }
  return out;
}

/** missing-id: NO tagNumber AND NO brandSequence (both blank). */
export function detectMissingId(animals: readonly TriageAnimal[]): Finding[] {
  const out: Finding[] = [];
  for (const a of animals) {
    if (isBlank(a.tagNumber) && isBlank(a.brandSequence)) {
      out.push(makeFinding(a, "missing-id"));
    }
  }
  return out;
}

/** Parse a dateOfBirth string; returns null when blank or unparseable. */
function parseDob(dob: string | null): Date | null {
  if (isBlank(dob)) return null;
  const d = new Date(dob as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** missing-dob: dateOfBirth is null, blank, or an unparseable date string. */
export function detectMissingDob(animals: readonly TriageAnimal[]): Finding[] {
  const out: Finding[] = [];
  for (const a of animals) {
    if (parseDob(a.dateOfBirth) === null) {
      out.push(makeFinding(a, "missing-dob"));
    }
  }
  return out;
}

/**
 * Conservative age bounds per (species, category). Only categories with an
 * UNAMBIGUOUS age signal are listed; everything else is intentionally absent
 * so it never flags (avoids import false-positives — locked scope decision 3).
 * Bounds are deliberately WIDE: a Calf is flagged only past 2 years (a real
 * weaner is < ~10 months), an adult only when younger than its youngest
 * plausible age. `min`/`max` are in YEARS; either may be omitted.
 */
const AGE_BOUNDS: Partial<Record<SpeciesId, Record<string, { minYears?: number; maxYears?: number }>>> = {
  cattle: {
    Calf: { maxYears: 2 },
    Cow: { minYears: 1 },
    Bull: { minYears: 1 },
  },
  sheep: {
    Lamb: { maxYears: 1.5 },
    "Ewe Lamb": { maxYears: 1.5 },
    Ewe: { minYears: 0.5 },
    Ram: { minYears: 0.5 },
  },
};

/**
 * age-for-category: flag CLEAR category/age mismatches only. Skips animals
 * with a missing/unparseable dob (that is `missing-dob`'s job) and any
 * category without a defined conservative bound.
 */
export function detectAgeForCategory(animals: readonly TriageAnimal[], now: Date): Finding[] {
  const out: Finding[] = [];
  for (const a of animals) {
    const dob = parseDob(a.dateOfBirth);
    if (dob === null) continue;
    const bound = AGE_BOUNDS[a.species]?.[a.category];
    if (!bound) continue;
    const ageYears = (now.getTime() - dob.getTime()) / MS_PER_YEAR;
    const tooOld = bound.maxYears != null && ageYears > bound.maxYears;
    const tooYoung = bound.minYears != null && ageYears < bound.minYears;
    if (tooOld || tooYoung) {
      out.push(makeFinding(a, "age-for-category"));
    }
  }
  return out;
}

/**
 * no-weight-on-record: animal has no weighing observation. Takes the
 * precomputed set of animalIds WITH a weighing. SUPPRESSED entirely when the
 * set is empty (zero animals weighed = day-1 import; we don't want every
 * animal flagged "no weight" — that reads as "nobody is weighed", not "this
 * animal is behind").
 */
export function detectNoWeightOnRecord(
  animals: readonly TriageAnimal[],
  animalIdsWithWeighing: ReadonlySet<string>,
): Finding[] {
  if (animalIdsWithWeighing.size === 0) return [];
  const out: Finding[] = [];
  for (const a of animals) {
    if (!animalIdsWithWeighing.has(a.animalId)) {
      out.push(makeFinding(a, "no-weight-on-record"));
    }
  }
  return out;
}

/** Compose every snapshot detector over one herd. Returns the union of findings. */
export function runSnapshotDetectors(
  animals: readonly TriageAnimal[],
  animalIdsWithWeighing: ReadonlySet<string>,
  now: Date,
): Finding[] {
  return [
    ...detectNoCamp(animals),
    ...detectMissingId(animals),
    ...detectMissingDob(animals),
    ...detectAgeForCategory(animals, now),
    ...detectNoWeightOnRecord(animals, animalIdsWithWeighing),
  ];
}
