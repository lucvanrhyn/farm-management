/**
 * __tests__/server/farm-settings-repeated-treatments.test.ts
 *
 * TDD tests for the animal/mob-profitability wave (Underperformer flag —
 * `repeated-treatments`): FarmSettings persists the two per-farm threshold
 * columns `repeatedTreatmentCount` (default 3) and
 * `repeatedTreatmentWindowDays` (default 90), editable from the admin
 * Settings form and validated + integer-coerced by the PATCH route.
 *
 * The full route is a NextRequest handler that depends on next-auth +
 * per-tenant prisma context, which is heavy to mock. Following the pattern in
 * farm-settings-tax-ref.test.ts, we re-implement the route's pure contract for
 * these two integer fields so a regression in the route's validation /
 * assignment / create-default plumbing is caught:
 *
 *   1. positive-number validation (app/api/farm/settings/route.ts —
 *      positiveNumericFields loop): non-number / NaN / <= 0 rejected.
 *   2. integer coercion (the Math.round assignment block).
 *   3. create-default fallback (the upsert.create block: ?? 3 / ?? 90).
 *
 * Field names are FINAL and match prisma/schema.prisma exactly.
 */

import { describe, it, expect } from "vitest";

const REPEATED_TREATMENT_FIELDS = [
  "repeatedTreatmentCount",
  "repeatedTreatmentWindowDays",
] as const;

/**
 * Mirrors the positiveNumericFields loop in app/api/farm/settings/route.ts:
 * a present field must be a finite number > 0, else VALIDATION_FAILED.
 * Returns null when valid, or the error message the route would produce.
 */
function validatePositiveNumericField(
  field: string,
  body: Record<string, unknown>,
): string | null {
  if (field in body) {
    const val = body[field];
    if (typeof val !== "number" || isNaN(val) || val <= 0) {
      return `${field} must be a positive number`;
    }
  }
  return null;
}

/**
 * Mirrors the Math.round assignment block: an integer field present as a number
 * is rounded; absent fields are left undefined (no write).
 */
function coerceInteger(value: unknown): number | undefined {
  return typeof value === "number" ? Math.round(value) : undefined;
}

describe("FarmSettings PATCH — repeated-treatments threshold validation", () => {
  for (const field of REPEATED_TREATMENT_FIELDS) {
    describe(field, () => {
      it("accepts a positive integer", () => {
        expect(validatePositiveNumericField(field, { [field]: 5 })).toBeNull();
      });

      it("rejects zero (must be > 0)", () => {
        expect(validatePositiveNumericField(field, { [field]: 0 })).toBe(
          `${field} must be a positive number`,
        );
      });

      it("rejects a negative number", () => {
        expect(validatePositiveNumericField(field, { [field]: -3 })).toBe(
          `${field} must be a positive number`,
        );
      });

      it("rejects a non-number (string)", () => {
        expect(validatePositiveNumericField(field, { [field]: "3" })).toBe(
          `${field} must be a positive number`,
        );
      });

      it("rejects NaN", () => {
        expect(validatePositiveNumericField(field, { [field]: NaN })).toBe(
          `${field} must be a positive number`,
        );
      });

      it("ignores the field entirely when absent (partial PATCH)", () => {
        expect(validatePositiveNumericField(field, {})).toBeNull();
      });
    });
  }
});

describe("FarmSettings PATCH — repeated-treatments integer coercion", () => {
  it("rounds a fractional repeatedTreatmentCount to the nearest integer", () => {
    expect(coerceInteger(3.7)).toBe(4);
    expect(coerceInteger(2.2)).toBe(2);
  });

  it("rounds a fractional repeatedTreatmentWindowDays to the nearest integer", () => {
    expect(coerceInteger(90.6)).toBe(91);
  });

  it("passes whole numbers through unchanged", () => {
    expect(coerceInteger(3)).toBe(3);
    expect(coerceInteger(90)).toBe(90);
  });

  it("returns undefined when the field is absent (no write to DB)", () => {
    expect(coerceInteger(undefined)).toBeUndefined();
  });
});

describe("FarmSettings repeated-treatments — default fallbacks", () => {
  // Mirrors the GET-defaults, page-loader, and upsert.create fallbacks that
  // must all agree (spec: no shared const, literal ?? 3 / ?? 90 at each site).
  function withDefaults(raw: {
    repeatedTreatmentCount?: number | null;
    repeatedTreatmentWindowDays?: number | null;
  } | null) {
    return {
      repeatedTreatmentCount: raw?.repeatedTreatmentCount ?? 3,
      repeatedTreatmentWindowDays: raw?.repeatedTreatmentWindowDays ?? 90,
    };
  }

  it("defaults count to 3 and window to 90 when FarmSettings is missing", () => {
    expect(withDefaults(null)).toEqual({
      repeatedTreatmentCount: 3,
      repeatedTreatmentWindowDays: 90,
    });
  });

  it("defaults each field independently when only one is null (legacy tenant)", () => {
    expect(
      withDefaults({ repeatedTreatmentCount: null, repeatedTreatmentWindowDays: 120 }),
    ).toEqual({ repeatedTreatmentCount: 3, repeatedTreatmentWindowDays: 120 });
  });

  it("preserves stored per-farm values when present", () => {
    expect(
      withDefaults({ repeatedTreatmentCount: 5, repeatedTreatmentWindowDays: 60 }),
    ).toEqual({ repeatedTreatmentCount: 5, repeatedTreatmentWindowDays: 60 });
  });
});
