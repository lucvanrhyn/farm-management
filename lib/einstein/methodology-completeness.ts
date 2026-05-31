/**
 * lib/einstein/methodology-completeness.ts — Issue #526 (PRD #521 W-G / #29).
 *
 * Pure, I/O-free scoring for the Farm Methodology Object so the admin shell can
 * nudge under-configured farms to fill it in. A sparse Methodology degrades the
 * context Farm Einstein gets injected, so surfacing "you've only filled N of 6"
 * is a cheap adoption lever.
 *
 * This module deliberately owns NO React, NO localStorage, NO Date — those live
 * in the client banner (components/einstein/MethodologyNudgeBanner.tsx). Keeping
 * the scoring pure means it is trivially unit-tested and reusable server-side
 * (the admin layout computes it once and passes the result down).
 *
 * The field set + types are the canonical ones from settings-schema.ts — this
 * file imports `FarmMethodology` rather than redefining the shape, so a future
 * wave that adds a methodology field only needs `METHODOLOGY_FIELDS` updated.
 */

import type { FarmMethodology } from './settings-schema';

/**
 * The six scored Methodology fields, in canonical order. Order is load-bearing:
 * `missing` is returned in this order so the banner can list gaps predictably.
 * Mirrors the `FarmMethodology` interface field-for-field.
 */
export const METHODOLOGY_FIELDS = [
  'tier',
  'speciesMix',
  'breedingCalendar',
  'rotationPolicy',
  'lsuThresholds',
  'farmerNotes',
] as const satisfies readonly (keyof FarmMethodology)[];

/** Number of scored fields — derived, never hard-coded downstream. */
export const METHODOLOGY_FIELD_COUNT = METHODOLOGY_FIELDS.length;

/**
 * Below this filled-ratio the nudge banner fires. At 0.5 a farm that has filled
 * 3 of 6 fields sits ON the boundary and is NOT nudged (the banner fires on
 * ratio STRICTLY below the threshold) — i.e. half-done is "good enough to leave
 * alone", under-half earns the nudge.
 */
export const LOW_COMPLETENESS_THRESHOLD = 0.5;

/** Result of scoring a Farm Methodology Object. */
export interface MethodologyCompleteness {
  /** Count of non-empty (trimmed) fields among the six. */
  readonly filled: number;
  /** Always the total number of scored fields. */
  readonly total: typeof METHODOLOGY_FIELD_COUNT;
  /** filled / total, in the inclusive range [0, 1]. */
  readonly ratio: number;
  /** Field keys that are missing / empty / whitespace, in canonical order. */
  readonly missing: (keyof FarmMethodology)[];
}

/** A field counts as filled iff it is a string with non-whitespace content. */
function isFilled(value: FarmMethodology[keyof FarmMethodology]): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Score a Farm Methodology Object. Pure: same input → same output, no I/O.
 *
 * Treats `undefined`, an empty object, empty strings, and whitespace-only
 * strings all as "not filled". Returns the filled count, the immutable total,
 * the ratio, and the ordered list of missing field keys.
 */
export function methodologyCompleteness(
  methodology?: FarmMethodology,
): MethodologyCompleteness {
  const missing: (keyof FarmMethodology)[] = [];
  let filled = 0;

  for (const field of METHODOLOGY_FIELDS) {
    if (methodology && isFilled(methodology[field])) {
      filled += 1;
    } else {
      missing.push(field);
    }
  }

  return {
    filled,
    total: METHODOLOGY_FIELD_COUNT,
    ratio: filled / METHODOLOGY_FIELD_COUNT,
    missing,
  };
}
