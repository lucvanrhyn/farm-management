/**
 * @vitest-environment node
 *
 * __tests__/api/observations/weighing-validator.test.ts
 *
 * Issue #487 (PRD #479, Epic C Phase 1) — species-aware weight validation at
 * BOTH observation write boundaries.
 *
 * Bug class — same family as #253 (reproductive-state) and #254 (death):
 *   Neither the logger nor the admin create/edit boundary capped the weight a
 *   client could persist. A stale / fat-fingered / malicious client could POST
 *   (or PATCH) a `weighing` observation with a negative weight, a zero, a
 *   non-numeric value, or a physically-impossible 999,999 kg. The downstream
 *   ADG / cost-of-gain / weight-history analytics then divided by or charted
 *   that garbage, producing nonsense KPIs.
 *
 * Defense-in-depth fix:
 *   1. UI: species-appropriate `min`/`max` on every weight input.
 *   2. Server: `validateWeighingObservation`, gated at:
 *        - CREATE: `createObservation` — AFTER the species-stamping waterfall,
 *          BEFORE the idempotency upsert (so a duplicate bad weight is rejected,
 *          never stored).
 *        - EDIT: `updateObservation` — reads the existing row's species, derives
 *          the cap, validates the incoming weight before persisting.
 *      Both map `WeightOutOfRangeError` onto `422 { error: "WEIGHT_OUT_OF_RANGE" }`
 *      via `mapApiDomainError`.
 *
 * Species caps (lib/species/breeding-constants.ts): cattle 1500, sheep 200,
 * game 1000, null/unknown → ABSOLUTE_MAX (1500). A 1300 kg bull PASSES; a 900 kg
 * sheep is REJECTED; 999,999 kg is rejected for every species.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  validateWeighingObservation,
  WeightOutOfRangeError,
} from "@/lib/server/validators/weighing";
import {
  getMaxLiveWeightKg,
  ABSOLUTE_MAX_LIVE_WEIGHT_KG,
} from "@/lib/species/breeding-constants";
import { mapApiDomainError } from "@/lib/server/api-errors";

// ── Unit: validateWeighingObservation in isolation ──────────────────────────

describe("validateWeighingObservation — valid weights pass", () => {
  it("passes a 1300 kg bull against the cattle cap (1500)", () => {
    expect(() =>
      validateWeighingObservation({ weight_kg: 1300 }, getMaxLiveWeightKg("cattle")),
    ).not.toThrow();
  });

  it("passes a typical 245.5 kg weaner", () => {
    expect(() =>
      validateWeighingObservation({ weight_kg: 245.5 }, getMaxLiveWeightKg("cattle")),
    ).not.toThrow();
  });

  it("passes a 150 kg sheep against the sheep cap (200)", () => {
    expect(() =>
      validateWeighingObservation({ weight_kg: 150 }, getMaxLiveWeightKg("sheep")),
    ).not.toThrow();
  });

  it("accepts the camelCase `weightKg` fallback key", () => {
    expect(() =>
      validateWeighingObservation({ weightKg: 420 }, getMaxLiveWeightKg("cattle")),
    ).not.toThrow();
  });

  it("accepts a numeric-string weight (offline queue stringifies payloads)", () => {
    expect(() =>
      validateWeighingObservation(
        JSON.stringify({ weight_kg: "450" }),
        getMaxLiveWeightKg("cattle"),
      ),
    ).not.toThrow();
  });

  it("accepts the cap boundary value exactly", () => {
    expect(() =>
      validateWeighingObservation({ weight_kg: 1500 }, getMaxLiveWeightKg("cattle")),
    ).not.toThrow();
  });
});

describe("validateWeighingObservation — over-cap rejection (WEIGHT_OUT_OF_RANGE)", () => {
  it("throws for a 999,999 kg garbage value (cattle)", () => {
    expect(() =>
      validateWeighingObservation({ weight_kg: 999_999 }, getMaxLiveWeightKg("cattle")),
    ).toThrow(WeightOutOfRangeError);
  });

  it("throws for a 999,999 kg garbage value against EVERY species cap", () => {
    for (const species of ["cattle", "sheep", "game", null, "elephant"]) {
      expect(() =>
        validateWeighingObservation(
          { weight_kg: 999_999 },
          getMaxLiveWeightKg(species),
        ),
      ).toThrow(WeightOutOfRangeError);
    }
  });

  it("throws for a 900 kg sheep (well above the 200 kg sheep cap)", () => {
    expect(() =>
      validateWeighingObservation({ weight_kg: 900 }, getMaxLiveWeightKg("sheep")),
    ).toThrow(WeightOutOfRangeError);
  });

  it("throws just above the cap boundary", () => {
    expect(() =>
      validateWeighingObservation({ weight_kg: 1501 }, getMaxLiveWeightKg("cattle")),
    ).toThrow(WeightOutOfRangeError);
  });

  it("error carries the canonical 422 wire code", () => {
    try {
      validateWeighingObservation({ weight_kg: 999_999 }, getMaxLiveWeightKg("cattle"));
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(WeightOutOfRangeError);
      expect((err as WeightOutOfRangeError).code).toBe("WEIGHT_OUT_OF_RANGE");
    }
  });
});

describe("validateWeighingObservation — non-positive rejection", () => {
  it("throws for a negative weight", () => {
    expect(() =>
      validateWeighingObservation({ weight_kg: -5 }, getMaxLiveWeightKg("cattle")),
    ).toThrow(WeightOutOfRangeError);
  });

  it("throws for a zero weight", () => {
    expect(() =>
      validateWeighingObservation({ weight_kg: 0 }, getMaxLiveWeightKg("cattle")),
    ).toThrow(WeightOutOfRangeError);
  });
});

describe("validateWeighingObservation — missing / non-numeric rejection", () => {
  it("throws when weight_kg is absent", () => {
    expect(() =>
      validateWeighingObservation({ method: "scale" }, getMaxLiveWeightKg("cattle")),
    ).toThrow(WeightOutOfRangeError);
  });

  it("throws when details is null", () => {
    expect(() =>
      validateWeighingObservation(null, getMaxLiveWeightKg("cattle")),
    ).toThrow(WeightOutOfRangeError);
  });

  it("throws on a non-numeric weight string", () => {
    expect(() =>
      validateWeighingObservation({ weight_kg: "heavy" }, getMaxLiveWeightKg("cattle")),
    ).toThrow(WeightOutOfRangeError);
  });

  it("throws on malformed JSON details", () => {
    expect(() =>
      validateWeighingObservation("{not json", getMaxLiveWeightKg("cattle")),
    ).toThrow(WeightOutOfRangeError);
  });
});

// ── Unit: species cap table ─────────────────────────────────────────────────

describe("getMaxLiveWeightKg — species cap resolution", () => {
  it("resolves the per-species caps", () => {
    expect(getMaxLiveWeightKg("cattle")).toBe(1500);
    expect(getMaxLiveWeightKg("sheep")).toBe(200);
    expect(getMaxLiveWeightKg("game")).toBe(1000);
  });

  it("falls back to the absolute ceiling for null / unknown species", () => {
    expect(getMaxLiveWeightKg(null)).toBe(ABSOLUTE_MAX_LIVE_WEIGHT_KG);
    expect(getMaxLiveWeightKg(undefined)).toBe(ABSOLUTE_MAX_LIVE_WEIGHT_KG);
    expect(getMaxLiveWeightKg("elephant")).toBe(ABSOLUTE_MAX_LIVE_WEIGHT_KG);
  });

  it("absolute ceiling is the MAX of every per-species cap (never loosens)", () => {
    expect(ABSOLUTE_MAX_LIVE_WEIGHT_KG).toBe(1500);
  });
});

// ── Unit: mapApiDomainError → 422 WEIGHT_OUT_OF_RANGE ────────────────────────

describe("mapApiDomainError — WeightOutOfRangeError → 422", () => {
  it("maps to 422 with the typed code (no raw message leak)", async () => {
    const res = mapApiDomainError(new WeightOutOfRangeError("internal detail"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(422);
    const body = await res!.json();
    expect(body).toEqual({ error: "WEIGHT_OUT_OF_RANGE" });
  });
});

// ── Door integration: createObservation gates BEFORE the upsert ──────────────

describe("createObservation — weight gate runs before the idempotency upsert", () => {
  const observationCreate = vi.fn();
  const observationUpsert = vi.fn();
  const observationFindFirst = vi.fn();
  const campFindFirst = vi.fn();
  const animalFindUnique = vi.fn();
  const mobFindUnique = vi.fn();
  const prisma = {
    observation: {
      create: observationCreate,
      upsert: observationUpsert,
      findFirst: observationFindFirst,
    },
    camp: { findFirst: campFindFirst },
    animal: { findUnique: animalFindUnique },
    mob: { findUnique: mobFindUnique },
  } as unknown as PrismaClient;

  beforeEach(() => {
    observationCreate.mockReset();
    observationUpsert.mockReset();
    observationFindFirst.mockReset();
    campFindFirst.mockReset();
    animalFindUnique.mockReset();
    mobFindUnique.mockReset();
    observationFindFirst.mockResolvedValue(null);
    campFindFirst.mockResolvedValue({ campId: "A", species: null });
    observationCreate.mockResolvedValue({ id: "obs-1" });
    observationUpsert.mockResolvedValue({ id: "obs-1" });
  });

  it("rejects an over-cap weight BEFORE the upsert (no row written) — duplicate-safe", async () => {
    const { createObservation } = await import(
      "@/lib/domain/observations/create-observation"
    );
    animalFindUnique.mockResolvedValue({ species: "cattle" });

    await expect(
      createObservation(prisma, {
        type: "weighing",
        camp_id: "A",
        animal_id: "COW-001",
        details: JSON.stringify({ weight_kg: 999_999 }),
        loggedBy: "u@x.co.za",
        // Carries a clientLocalId so the upsert path WOULD be taken — the gate
        // must fire first so a re-POSTed duplicate bad weight is never stored.
        clientLocalId: "uuid-1",
      }),
    ).rejects.toBeInstanceOf(WeightOutOfRangeError);

    expect(observationUpsert).not.toHaveBeenCalled();
    expect(observationCreate).not.toHaveBeenCalled();
  });

  it("rejects a 900 kg weight for a SHEEP (sheep cap 200) — species-aware", async () => {
    const { createObservation } = await import(
      "@/lib/domain/observations/create-observation"
    );
    animalFindUnique.mockResolvedValue({ species: "sheep" });

    await expect(
      createObservation(prisma, {
        type: "weighing",
        camp_id: "A",
        animal_id: "EWE-001",
        details: JSON.stringify({ weight_kg: 900 }),
        loggedBy: "u@x.co.za",
      }),
    ).rejects.toBeInstanceOf(WeightOutOfRangeError);
    expect(observationCreate).not.toHaveBeenCalled();
  });

  it("lets a 900 kg weight through for CATTLE (same value, different species)", async () => {
    const { createObservation } = await import(
      "@/lib/domain/observations/create-observation"
    );
    animalFindUnique.mockResolvedValue({ species: "cattle" });

    const result = await createObservation(prisma, {
      type: "weighing",
      camp_id: "A",
      animal_id: "COW-001",
      details: JSON.stringify({ weight_kg: 900 }),
      loggedBy: "u@x.co.za",
    });
    expect(result).toEqual({ success: true, id: "obs-1" });
    expect(observationCreate).toHaveBeenCalled();
  });

  it("rejects a negative weight", async () => {
    const { createObservation } = await import(
      "@/lib/domain/observations/create-observation"
    );
    animalFindUnique.mockResolvedValue({ species: "cattle" });

    await expect(
      createObservation(prisma, {
        type: "weighing",
        camp_id: "A",
        animal_id: "COW-001",
        details: JSON.stringify({ weight_kg: -10 }),
        loggedBy: "u@x.co.za",
      }),
    ).rejects.toBeInstanceOf(WeightOutOfRangeError);
    expect(observationCreate).not.toHaveBeenCalled();
  });

  it("lets a clean 1300 kg bull through (200)", async () => {
    const { createObservation } = await import(
      "@/lib/domain/observations/create-observation"
    );
    animalFindUnique.mockResolvedValue({ species: "cattle" });

    const result = await createObservation(prisma, {
      type: "weighing",
      camp_id: "A",
      animal_id: "BULL-001",
      details: JSON.stringify({ weight_kg: 1300 }),
      loggedBy: "u@x.co.za",
    });
    expect(result).toEqual({ success: true, id: "obs-1" });
    expect(observationCreate).toHaveBeenCalled();
  });

  it("does NOT gate a non-weighing observation (scope discipline)", async () => {
    const { createObservation } = await import(
      "@/lib/domain/observations/create-observation"
    );
    animalFindUnique.mockResolvedValue({ species: "cattle" });

    const result = await createObservation(prisma, {
      type: "treatment",
      camp_id: "A",
      animal_id: "COW-001",
      details: JSON.stringify({ weight_kg: 999_999, treatmentType: "Dip" }),
      loggedBy: "u@x.co.za",
    });
    expect(result).toEqual({ success: true, id: "obs-1" });
    expect(observationCreate).toHaveBeenCalled();
  });
});

// ── Door integration: updateObservation gates the edit ───────────────────────

describe("updateObservation — weight gate at the edit boundary", () => {
  const findUnique = vi.fn();
  const update = vi.fn();
  const prisma = {
    observation: { findUnique, update },
  } as unknown as PrismaClient;

  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
  });

  it("rejects editing a clean weighing into an over-cap weight (no persist)", async () => {
    const { updateObservation } = await import(
      "@/lib/domain/observations/update-observation"
    );
    findUnique.mockResolvedValue({
      id: "obs-1",
      type: "weighing",
      species: "cattle",
      details: JSON.stringify({ weight_kg: 450 }),
      editHistory: null,
    });

    await expect(
      updateObservation(prisma, {
        id: "obs-1",
        details: JSON.stringify({ weight_kg: 999_999 }),
        editedBy: "admin@x.co.za",
      }),
    ).rejects.toBeInstanceOf(WeightOutOfRangeError);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a 900 kg edit on a SHEEP weighing row (species from the row)", async () => {
    const { updateObservation } = await import(
      "@/lib/domain/observations/update-observation"
    );
    findUnique.mockResolvedValue({
      id: "obs-2",
      type: "weighing",
      species: "sheep",
      details: JSON.stringify({ weight_kg: 80 }),
      editHistory: null,
    });

    await expect(
      updateObservation(prisma, {
        id: "obs-2",
        details: JSON.stringify({ weight_kg: 900 }),
        editedBy: "admin@x.co.za",
      }),
    ).rejects.toBeInstanceOf(WeightOutOfRangeError);
    expect(update).not.toHaveBeenCalled();
  });

  it("lets a valid weight edit through and persists it", async () => {
    const { updateObservation } = await import(
      "@/lib/domain/observations/update-observation"
    );
    findUnique.mockResolvedValue({
      id: "obs-3",
      type: "weighing",
      species: "cattle",
      details: JSON.stringify({ weight_kg: 450 }),
      editHistory: null,
    });
    const updated = { id: "obs-3", details: JSON.stringify({ weight_kg: 480 }) };
    update.mockResolvedValue(updated);

    const result = await updateObservation(prisma, {
      id: "obs-3",
      details: JSON.stringify({ weight_kg: 480 }),
      editedBy: "admin@x.co.za",
    });
    expect(result).toBe(updated);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("does NOT gate a non-weighing edit (scope discipline)", async () => {
    const { updateObservation } = await import(
      "@/lib/domain/observations/update-observation"
    );
    findUnique.mockResolvedValue({
      id: "obs-4",
      type: "treatment",
      species: "cattle",
      details: JSON.stringify({ treatmentType: "Dip" }),
      editHistory: null,
    });
    const updated = { id: "obs-4", details: JSON.stringify({ weight_kg: 999_999 }) };
    update.mockResolvedValue(updated);

    const result = await updateObservation(prisma, {
      id: "obs-4",
      details: JSON.stringify({ weight_kg: 999_999 }),
      editedBy: "admin@x.co.za",
    });
    expect(result).toBe(updated);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
