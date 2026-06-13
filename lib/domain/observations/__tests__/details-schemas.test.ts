/**
 * @vitest-environment node
 *
 * ADR-0007 (#513) — per-observation-type `details` Zod schema registry.
 *
 * The registry is the single home for every typed observation's structured
 * `details` contract. This suite proves the registry's own contract:
 *
 *   1. `getDetailsSchema(type)` returns a schema for a registered type and
 *      `undefined` for an unregistered (pass-through) type.
 *   2. The weighing entry is a `(speciesMax) => schema` factory (dynamic cap).
 *   3. `.passthrough()` is honoured — extra provenance keys never reject.
 *   4. The single door-facing entry `validateObservationDetails(type, details,
 *      ctx)` re-throws the LEGACY typed error (byte-identical wire code) for
 *      each migrated family, and is a no-op for unregistered types.
 *
 * The per-family BEHAVIOUR (every edge case) is regression-locked by the
 * existing validator suites under `__tests__/api/observations/*` — those keep
 * asserting on the re-homed `validate*` wrappers. This suite covers only the
 * registry shape + the unified door entry that those suites don't exercise.
 */
import { describe, it, expect } from "vitest";

import {
  DETAILS_SCHEMAS,
  getDetailsSchema,
  weighingDetailsSchema,
  validateObservationDetails,
  DetailsValidationError,
  WeightOutOfRangeError,
  DeathMultiCauseError,
  DeathDisposalRequiredError,
  ReproMultiStateError,
  ReproRequiredError,
  ReproFieldRequiredError,
  CampConditionFieldRequiredError,
  CARCASS_DISPOSAL_VALUES,
} from "../details-schemas";

describe("DETAILS_SCHEMAS registry — shape", () => {
  it("registers exactly the ten typed observations (nine first-adopters + scrotal_circumference, obs-M1)", () => {
    // ADR-0007 scope decision: the set already validated today — extended by
    // S24 / obs-M1 with `scrotal_circumference`, the ReproductionForm sub-flow
    // that fed breeding scoring with NO server-side gate.
    expect(Object.keys(DETAILS_SCHEMAS).sort()).toEqual(
      [
        "body_condition_score",
        "calving",
        "camp_condition",
        "death",
        "heat_detection",
        "insemination",
        "pregnancy_scan",
        "scrotal_circumference",
        "temperament_score",
        "weighing",
      ].sort(),
    );
  });

  it("getDetailsSchema returns undefined for an unregistered (pass-through) type", () => {
    expect(getDetailsSchema("treatment")).toBeUndefined();
    expect(getDetailsSchema("general")).toBeUndefined();
    expect(getDetailsSchema("mob_movement")).toBeUndefined();
  });

  it("getDetailsSchema returns a schema for a registered type", () => {
    expect(getDetailsSchema("death")).toBeDefined();
    expect(getDetailsSchema("camp_condition")).toBeDefined();
  });
});

describe("weighingDetailsSchema — dynamic species cap factory", () => {
  it("is a factory: different caps reject the same value differently", () => {
    // 900 kg passes the cattle cap (1500) but fails the sheep cap (200).
    expect(() =>
      weighingDetailsSchema(1500).parse({ weight_kg: 900 }),
    ).not.toThrow();
    expect(() => weighingDetailsSchema(200).parse({ weight_kg: 900 })).toThrow();
  });

  it("coerces a numeric-string weight (offline queue stringifies)", () => {
    expect(() =>
      weighingDetailsSchema(1500).parse({ weight_kg: "450" }),
    ).not.toThrow();
  });

  it("passes through extra provenance keys (does not reject .strict-style)", () => {
    const parsed = weighingDetailsSchema(1500).parse({
      weight_kg: 450,
      logged_by: "u@x.co.za",
      method: "scale",
    }) as Record<string, unknown>;
    expect(parsed.logged_by).toBe("u@x.co.za");
    expect(parsed.method).toBe("scale");
  });
});

describe("validateObservationDetails — door-facing unified entry", () => {
  it("is a no-op for an unregistered type (pass-through default)", () => {
    expect(() =>
      validateObservationDetails("treatment", JSON.stringify({ anything: 1 }), {
        speciesMax: 1500,
      }),
    ).not.toThrow();
  });

  it("re-throws WeightOutOfRangeError for a bad weighing (byte-identical code)", () => {
    try {
      validateObservationDetails(
        "weighing",
        JSON.stringify({ weight_kg: 999_999 }),
        { speciesMax: 1500 },
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(WeightOutOfRangeError);
      expect((err as WeightOutOfRangeError).code).toBe("WEIGHT_OUT_OF_RANGE");
    }
  });

  it("re-throws CampConditionFieldRequiredError for an incomplete camp_condition", () => {
    try {
      validateObservationDetails(
        "camp_condition",
        JSON.stringify({ grazing: "Good", water: "Full" }),
        { speciesMax: 1500 },
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CampConditionFieldRequiredError);
      expect((err as CampConditionFieldRequiredError).code).toBe(
        "CAMP_CONDITION_FIELD_REQUIRED",
      );
      expect((err as CampConditionFieldRequiredError).field).toBe("fence");
    }
  });

  it("re-throws DeathDisposalRequiredError for a death missing disposal", () => {
    try {
      validateObservationDetails(
        "death",
        JSON.stringify({ cause: "Old age" }),
        { speciesMax: 1500 },
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DeathDisposalRequiredError);
      expect((err as DeathDisposalRequiredError).code).toBe(
        "DEATH_DISPOSAL_REQUIRED",
      );
    }
  });

  it("re-throws DeathMultiCauseError for a death asserting multiple causes", () => {
    expect(() =>
      validateObservationDetails(
        "death",
        JSON.stringify({ causes: ["Disease", "Predator"], carcassDisposal: "BURIED" }),
        { speciesMax: 1500 },
      ),
    ).toThrow(DeathMultiCauseError);
  });

  it("dispatches scrotal_circumference through the repro family (S24 / obs-M1)", () => {
    // A measurement outside the UI's 20..50 cm bounds (or missing/NaN) must
    // be rejected at the door — pre-obs-M1 this type passed through entirely
    // unvalidated and fed garbage into breeding scoring (`trait-profile.ts`).
    expect(() =>
      validateObservationDetails(
        "scrotal_circumference",
        JSON.stringify({ measurement_cm: "5" }),
        { speciesMax: 1500 },
      ),
    ).toThrow(ReproFieldRequiredError);
    expect(() =>
      validateObservationDetails(
        "scrotal_circumference",
        JSON.stringify({ measurement_cm: "36.5", logged_by: "u@x.co.za" }),
        { speciesMax: 1500 },
      ),
    ).not.toThrow();
  });

  it("re-throws ReproMultiStateError for a multi-state repro payload", () => {
    expect(() =>
      validateObservationDetails(
        "pregnancy_scan",
        JSON.stringify({ pregnant: true, open: true }),
        { speciesMax: 1500 },
      ),
    ).toThrow(ReproMultiStateError);
  });

  it("re-throws ReproRequiredError for an empty repro payload", () => {
    expect(() =>
      validateObservationDetails("pregnancy_scan", JSON.stringify({}), {
        speciesMax: 1500,
      }),
    ).toThrow(ReproRequiredError);
  });

  it("re-throws ReproFieldRequiredError for a calving missing calf identity", () => {
    expect(() =>
      validateObservationDetails(
        "calving",
        JSON.stringify({ calf_status: "live" }),
        { speciesMax: 1500 },
      ),
    ).toThrow(ReproFieldRequiredError);
  });

  it("lets a clean payload of every migrated family through", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["weighing", { weight_kg: 450 }],
      ["camp_condition", { grazing: "Good", water: "Full", fence: "Intact" }],
      ["death", { cause: "Old age", carcassDisposal: "BURIED" }],
      ["heat_detection", { method: "visual" }],
      ["pregnancy_scan", { result: "pregnant" }],
      ["insemination", { method: "AI" }],
      ["body_condition_score", { score: 5 }],
      ["temperament_score", { score: 3 }],
      ["calving", { calf_tag: "CALF-2026-001" }],
    ];
    for (const [type, details] of cases) {
      expect(
        () =>
          validateObservationDetails(type, JSON.stringify(details), {
            speciesMax: 1500,
          }),
        `${type} clean payload should pass`,
      ).not.toThrow();
    }
  });
});

describe("CARCASS_DISPOSAL_VALUES — locked enum survives the migration", () => {
  it("still exports the four maintainer-locked values verbatim", () => {
    expect(CARCASS_DISPOSAL_VALUES).toEqual([
      "BURIED",
      "BURNED",
      "RENDERED",
      "OTHER",
    ]);
  });
});

describe("DetailsValidationError — canonical envelope (future typed schemas)", () => {
  it("carries the canonical code + a Zod issue list", () => {
    const err = new DetailsValidationError([
      // minimal issue shape — path + code + message
      { code: "custom", message: "bad", path: ["x"] } as never,
    ]);
    expect(err.code).toBe("DETAILS_VALIDATION_FAILED");
    expect(Array.isArray(err.issues)).toBe(true);
    expect(err.issues).toHaveLength(1);
  });
});
