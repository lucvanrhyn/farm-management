/**
 * @vitest-environment node
 *
 * Wave C (#156) — domain op: `createObservation`.
 *
 * Creates an observation row after enforcing three business rules:
 *   1. `type` must be in the allowlist of recognised observation kinds
 *      (defends against arbitrary type-string injection from offline
 *      clients).
 *   2. `created_at`, when supplied, must parse to a valid Date.
 *   3. `camp_id` must reference an existing camp in the tenant.
 *
 * Phase I.3 — when `animal_id` is supplied, the op denormalises
 * `Animal.species` onto the observation row so admin filters can scope
 * by species without a join.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  createObservation,
  CampConditionFieldRequiredError,
} from "../create-observation";
import {
  CampNotFoundError,
  InvalidTimestampError,
  InvalidTypeError,
} from "../errors";

describe("createObservation(prisma, input)", () => {
  const observationCreate = vi.fn();
  const campFindFirst = vi.fn();
  const animalFindUnique = vi.fn();
  const prisma = {
    observation: { create: observationCreate },
    camp: { findFirst: campFindFirst },
    animal: { findUnique: animalFindUnique },
  } as unknown as PrismaClient;

  beforeEach(() => {
    observationCreate.mockReset();
    campFindFirst.mockReset();
    animalFindUnique.mockReset();
  });

  it("throws InvalidTypeError when the type is not in the allowlist", async () => {
    await expect(
      createObservation(prisma, {
        type: "DROP TABLE Observation",
        camp_id: "A",
        loggedBy: null,
      }),
    ).rejects.toBeInstanceOf(InvalidTypeError);
    expect(observationCreate).not.toHaveBeenCalled();
  });

  it("throws InvalidTimestampError when created_at does not parse", async () => {
    await expect(
      createObservation(prisma, {
        type: "camp_check",
        camp_id: "A",
        created_at: "not-a-date",
        loggedBy: null,
      }),
    ).rejects.toBeInstanceOf(InvalidTimestampError);
    expect(observationCreate).not.toHaveBeenCalled();
  });

  it("throws CampNotFoundError when no camp matches camp_id", async () => {
    campFindFirst.mockResolvedValue(null);

    await expect(
      createObservation(prisma, {
        type: "camp_check",
        camp_id: "MISSING",
        loggedBy: null,
      }),
    ).rejects.toBeInstanceOf(CampNotFoundError);
    expect(observationCreate).not.toHaveBeenCalled();
  });

  it("creates the row with denormalised species when animal_id is supplied", async () => {
    campFindFirst.mockResolvedValue({ campId: "A" });
    animalFindUnique.mockResolvedValue({ species: "cattle" });
    observationCreate.mockResolvedValue({ id: "obs-1" });

    const result = await createObservation(prisma, {
      type: "weighing",
      camp_id: "A",
      animal_id: "BR-001",
      details: JSON.stringify({ weightKg: 420 }),
      created_at: "2026-05-01T08:00:00.000Z",
      loggedBy: "u@x.co.za",
    });

    expect(result).toEqual({ success: true, id: "obs-1" });
    expect(observationCreate).toHaveBeenCalledWith({
      data: {
        type: "weighing",
        campId: "A",
        animalId: "BR-001",
        details: JSON.stringify({ weightKg: 420 }),
        observedAt: new Date("2026-05-01T08:00:00.000Z"),
        loggedBy: "u@x.co.za",
        species: "cattle",
      },
    });
  });

  it("creates the row with species=null when animal_id is absent", async () => {
    campFindFirst.mockResolvedValue({ campId: "A" });
    observationCreate.mockResolvedValue({ id: "obs-2" });

    await createObservation(prisma, {
      type: "camp_check",
      camp_id: "A",
      loggedBy: null,
    });

    expect(animalFindUnique).not.toHaveBeenCalled();
    expect(observationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "camp_check",
        campId: "A",
        animalId: null,
        species: null,
        details: "",
      }),
    });
  });

  // Issue #321 (PRD #318, wave R4) — camp_condition required-field guard.
  //
  // Root cause: `CampConditionForm` pre-selected grazing="Good",
  // water="Full", fence="Intact" and left Submit permanently enabled, so a
  // zero-interaction (or stale offline) submit persisted those defaults as
  // the farmer's *answer*, indistinguishable from a deliberate clean
  // inspection. With the client now emitting unselected sentinels, a stale
  // client could still POST a `camp_condition` whose `details` omits an
  // explicit grazing/water/fence selection. The domain op rejects that at
  // the write boundary instead of silently persisting an implicit reading.
  describe("camp_condition required-field validation (#321)", () => {
    beforeEach(() => {
      campFindFirst.mockResolvedValue({ campId: "A" });
    });

    it("rejects a camp_condition whose details omits the grazing selection", async () => {
      await expect(
        createObservation(prisma, {
          type: "camp_condition",
          camp_id: "A",
          details: JSON.stringify({ water: "Full", fence: "Intact" }),
          loggedBy: null,
        }),
      ).rejects.toBeInstanceOf(CampConditionFieldRequiredError);
      expect(observationCreate).not.toHaveBeenCalled();
    });

    it("rejects when a selection is present but null/empty (implicit default)", async () => {
      await expect(
        createObservation(prisma, {
          type: "camp_condition",
          camp_id: "A",
          details: JSON.stringify({
            grazing: "Good",
            water: null,
            fence: "Intact",
          }),
          loggedBy: null,
        }),
      ).rejects.toBeInstanceOf(CampConditionFieldRequiredError);
      expect(observationCreate).not.toHaveBeenCalled();
    });

    it("rejects when details is empty (no payload at all)", async () => {
      await expect(
        createObservation(prisma, {
          type: "camp_condition",
          camp_id: "A",
          details: "",
          loggedBy: null,
        }),
      ).rejects.toBeInstanceOf(CampConditionFieldRequiredError);
      expect(observationCreate).not.toHaveBeenCalled();
    });

    it("names the first missing field on the thrown error", async () => {
      await expect(
        createObservation(prisma, {
          type: "camp_condition",
          camp_id: "A",
          details: JSON.stringify({ grazing: "Good", water: "Low" }),
          loggedBy: null,
        }),
      ).rejects.toMatchObject({
        code: "CAMP_CONDITION_FIELD_REQUIRED",
        field: "fence",
      });
    });

    it("accepts a fully-specified camp_condition and writes the row", async () => {
      observationCreate.mockResolvedValue({ id: "obs-cc" });

      const result = await createObservation(prisma, {
        type: "camp_condition",
        camp_id: "A",
        details: JSON.stringify({
          grazing: "Poor",
          water: "Low",
          fence: "Damaged",
          logged_by: "u@x.co.za",
        }),
        loggedBy: "u@x.co.za",
      });

      expect(result).toEqual({ success: true, id: "obs-cc" });
      expect(observationCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: "camp_condition",
          campId: "A",
          details: JSON.stringify({
            grazing: "Poor",
            water: "Low",
            fence: "Damaged",
            logged_by: "u@x.co.za",
          }),
        }),
      });
    });

    it("leaves other observation types unaffected (no camp_condition guard)", async () => {
      observationCreate.mockResolvedValue({ id: "obs-cc2" });

      // camp_check carries an unrelated details shape — must not be gated.
      await createObservation(prisma, {
        type: "camp_check",
        camp_id: "A",
        details: JSON.stringify({ status: "Normal" }),
        loggedBy: null,
      });

      expect(observationCreate).toHaveBeenCalledTimes(1);
    });
  });

  it("uses 'now' for observedAt when created_at is omitted", async () => {
    campFindFirst.mockResolvedValue({ campId: "A" });
    observationCreate.mockResolvedValue({ id: "obs-3" });

    const before = Date.now();
    await createObservation(prisma, {
      type: "camp_check",
      camp_id: "A",
      loggedBy: null,
    });
    const after = Date.now();

    const callArg = observationCreate.mock.calls[0][0];
    const observedAt = callArg.data.observedAt as Date;
    expect(observedAt).toBeInstanceOf(Date);
    expect(observedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(observedAt.getTime()).toBeLessThanOrEqual(after);
  });
});
