/**
 * lib/domain/observations/__tests__/weighing-mass.test.ts
 *
 * Locks the SINGLE definition of "a weighing observation's mass". Weighings are
 * persisted under TWO key conventions by two write paths:
 *   - logger / admin modal  → snake_case  { weight_kg: <n> }
 *   - task-completion        → camelCase   { weightKg:  <n> }
 * (lib/tasks/observation-mapping.ts vs app/[farmSlug]/logger/[campId]/page.tsx).
 *
 * Every reader MUST count both, or a whole class of weighings is silently
 * invisible (the recurring "snake-only reader" bug — poor-doer, profitability,
 * weight-analytics, financial-analytics, cog-breakeven all drifted at least
 * once). This helper is the one place that knows the convention; the unit test
 * is the regression lock for the bug class.
 *
 * The accepted-value semantics are byte-identical to the on-write validator
 * `weighingDetailsSchema` (details-schemas.ts) so a reader counts EXACTLY the
 * weighings the validator accepts: number or numeric-string, finite; ≤0 is
 * returned verbatim (the >0 rule is the caller's, matching legacy reader code).
 */
import { describe, it, expect } from "vitest";
import {
  weighingMassKg,
  parseWeighingMassKg,
} from "@/lib/domain/observations/weighing-mass";

describe("weighingMassKg — dual-key weighing mass (object form)", () => {
  it("reads snake_case weight_kg", () => {
    expect(weighingMassKg({ weight_kg: 412 })).toBe(412);
  });

  it("reads camelCase weightKg (the task-completion write path)", () => {
    expect(weighingMassKg({ weightKg: 305 })).toBe(305);
  });

  it("prefers snake_case when BOTH keys are present (canonical precedence)", () => {
    expect(weighingMassKg({ weight_kg: 400, weightKg: 999 })).toBe(400);
  });

  it("coerces a numeric string (matches the on-write validator)", () => {
    expect(weighingMassKg({ weight_kg: "287.5" })).toBe(287.5);
    expect(weighingMassKg({ weightKg: "150" })).toBe(150);
  });

  it("returns the value verbatim even when ≤ 0 (caller applies the >0 rule)", () => {
    expect(weighingMassKg({ weight_kg: 0 })).toBe(0);
    expect(weighingMassKg({ weight_kg: -5 })).toBe(-5);
  });

  it("returns null for a missing / non-numeric / non-finite mass", () => {
    expect(weighingMassKg({})).toBeNull();
    expect(weighingMassKg({ weight_kg: "heavy" })).toBeNull();
    expect(weighingMassKg({ weight_kg: NaN })).toBeNull();
    expect(weighingMassKg({ weight_kg: Infinity })).toBeNull();
    expect(weighingMassKg(null)).toBeNull();
    expect(weighingMassKg(undefined)).toBeNull();
  });
});

describe("parseWeighingMassKg — dual-key weighing mass (raw JSON string form)", () => {
  it("parses snake_case from a raw details string", () => {
    expect(parseWeighingMassKg(JSON.stringify({ weight_kg: 412 }))).toBe(412);
  });

  it("parses camelCase from a raw details string", () => {
    expect(parseWeighingMassKg(JSON.stringify({ weightKg: 305 }))).toBe(305);
  });

  it("returns null on malformed JSON (never throws)", () => {
    expect(parseWeighingMassKg("{not json")).toBeNull();
    expect(parseWeighingMassKg("")).toBeNull();
  });

  it("returns null when the parsed JSON is not an object", () => {
    expect(parseWeighingMassKg("42")).toBeNull();
    expect(parseWeighingMassKg("null")).toBeNull();
    expect(parseWeighingMassKg('"weight"')).toBeNull();
  });
});
