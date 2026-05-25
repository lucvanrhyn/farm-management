/**
 * __tests__/lib/domain/observations/is-camp-inspection.test.ts
 *
 * Issue #413 — locks the predicate `isCampInspection(type)` used by
 * `observationWriteTags` to decide whether to invalidate the
 * `farm-<slug>-camps` cache tag on observation write.
 *
 * The predicate's source of truth is a frozen `Set` derived from the
 * observation registry — NOT a magic-string `if` chain in the call site.
 * If the camp-inspection observation types ever change, the registry-derived
 * set is the only thing that needs to update.
 */

import { describe, it, expect } from "vitest";
import { isCampInspection, CAMP_INSPECTION_OBSERVATION_TYPES } from "@/lib/domain/observations/is-camp-inspection";
import { OBSERVATION_TYPE_LIST } from "@/lib/domain/observations/registry";

describe("isCampInspection", () => {
  it("returns true for camp_condition (the canonical camp-inspection write)", () => {
    expect(isCampInspection("camp_condition")).toBe(true);
  });

  it("returns true for camp_check (a logged camp visit without a full condition score)", () => {
    expect(isCampInspection("camp_check")).toBe(true);
  });

  it("returns false for weight_record / weighing (animal-scoped, no camp side-effect)", () => {
    expect(isCampInspection("weight_record")).toBe(false);
    expect(isCampInspection("weighing")).toBe(false);
  });

  it("returns false for every non-camp-inspection registry type", () => {
    const nonCampInspection = OBSERVATION_TYPE_LIST.filter(
      (t) => t !== "camp_condition" && t !== "camp_check",
    );
    for (const type of nonCampInspection) {
      expect(isCampInspection(type)).toBe(false);
    }
  });

  it("returns false for unknown / arbitrary strings (predicate is closed-set, not allow-anything)", () => {
    expect(isCampInspection("")).toBe(false);
    expect(isCampInspection("not_a_real_type")).toBe(false);
    expect(isCampInspection("CAMP_CONDITION")).toBe(false); // case-sensitive
  });

  it("returns false for null/undefined inputs (defensive — callers may pass body.type unchecked)", () => {
    // @ts-expect-error — predicate must be defensive against runtime null
    expect(isCampInspection(null)).toBe(false);
    // @ts-expect-error — predicate must be defensive against runtime undefined
    expect(isCampInspection(undefined)).toBe(false);
  });
});

describe("CAMP_INSPECTION_OBSERVATION_TYPES (the frozen registry-derived set)", () => {
  it("is a ReadonlySet — the call-site can iterate but cannot mutate", () => {
    expect(CAMP_INSPECTION_OBSERVATION_TYPES).toBeInstanceOf(Set);
    // Frozen — TS marks as readonly; runtime check via Object.isFrozen on the wrapper
    expect(Object.isFrozen(CAMP_INSPECTION_OBSERVATION_TYPES)).toBe(true);
  });

  it("contains exactly camp_condition + camp_check (matches issue #413 spec)", () => {
    expect(CAMP_INSPECTION_OBSERVATION_TYPES.has("camp_condition")).toBe(true);
    expect(CAMP_INSPECTION_OBSERVATION_TYPES.has("camp_check")).toBe(true);
    expect(CAMP_INSPECTION_OBSERVATION_TYPES.size).toBe(2);
  });

  it("every member is a valid observation type in the OBSERVATION_TYPE_LIST registry", () => {
    for (const t of CAMP_INSPECTION_OBSERVATION_TYPES) {
      expect(OBSERVATION_TYPE_LIST).toContain(t);
    }
  });
});
