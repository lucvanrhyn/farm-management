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

import { createObservation } from "../create-observation";
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
