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
  AnimalNotFoundError,
  CampNotFoundError,
  DuplicateObservationError,
  InvalidTimestampError,
  InvalidTypeError,
  MobNotFoundError,
} from "../errors";

describe("createObservation(prisma, input)", () => {
  const observationCreate = vi.fn();
  const observationUpsert = vi.fn();
  const observationFindFirst = vi.fn();
  const campFindFirst = vi.fn();
  const animalFindUnique = vi.fn();
  const mobFindUnique = vi.fn();
  // Cast through `unknown` — the mock only stubs the surface
  // `createObservation` touches, not the full PrismaClient API.
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
    // Default: no pre-existing duplicate. Tests that exercise the #366
    // duplicate guard override this per-case.
    observationFindFirst.mockResolvedValue(null);
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
    campFindFirst.mockResolvedValue({ campId: "A", species: null });
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
      data: expect.objectContaining({
        type: "weighing",
        campId: "A",
        animalId: "BR-001",
        details: JSON.stringify({ weightKg: 420 }),
        observedAt: new Date("2026-05-01T08:00:00.000Z"),
        loggedBy: "u@x.co.za",
        species: "cattle",
      }),
    });
  });

  it("creates the row with species=null when neither animal_id nor mob_id nor camp species is in scope", async () => {
    // ADR-0006 step 4 of the waterfall: camp has no species and no
    // animal/mob context → null is the explicit back-compat outcome.
    campFindFirst.mockResolvedValue({ campId: "A", species: null });
    observationCreate.mockResolvedValue({ id: "obs-2" });

    await createObservation(prisma, {
      type: "camp_check",
      camp_id: "A",
      loggedBy: null,
    });

    expect(animalFindUnique).not.toHaveBeenCalled();
    expect(mobFindUnique).not.toHaveBeenCalled();
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

  // ── ADR-0006 waterfall ────────────────────────────────────────────────
  describe("species-stamping waterfall (ADR-0006)", () => {
    it("throws AnimalNotFoundError when animal_id resolves to no row", async () => {
      campFindFirst.mockResolvedValue({ campId: "A", species: null });
      animalFindUnique.mockResolvedValue(null);

      await expect(
        createObservation(prisma, {
          type: "weighing",
          camp_id: "A",
          animal_id: "DELETED",
          details: JSON.stringify({ weightKg: 100 }),
          loggedBy: null,
        }),
      ).rejects.toBeInstanceOf(AnimalNotFoundError);
      expect(observationCreate).not.toHaveBeenCalled();
    });

    it("throws MobNotFoundError when mob_id resolves to no row", async () => {
      campFindFirst.mockResolvedValue({ campId: "A", species: null });
      mobFindUnique.mockResolvedValue(null);

      await expect(
        createObservation(prisma, {
          type: "mob_movement",
          camp_id: "A",
          mob_id: "DELETED",
          loggedBy: null,
        }),
      ).rejects.toBeInstanceOf(MobNotFoundError);
      expect(observationCreate).not.toHaveBeenCalled();
    });

    it("stamps species from mob when only mob_id is given", async () => {
      campFindFirst.mockResolvedValue({ campId: "A", species: null });
      mobFindUnique.mockResolvedValue({ species: "sheep" });
      observationCreate.mockResolvedValue({ id: "obs-mob" });

      await createObservation(prisma, {
        type: "mob_movement",
        camp_id: "A",
        mob_id: "mob-1",
        loggedBy: null,
      });

      expect(animalFindUnique).not.toHaveBeenCalled();
      expect(mobFindUnique).toHaveBeenCalledWith({
        where: { id: "mob-1" },
        select: { species: true },
      });
      expect(observationCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: "mob_movement",
          campId: "A",
          species: "sheep",
        }),
      });
    });

    it("stamps species from camp when neither animal_id nor mob_id is given", async () => {
      // Step 3 — the resolved camp carries a species.
      campFindFirst.mockResolvedValue({ campId: "A", species: "game" });
      observationCreate.mockResolvedValue({ id: "obs-camp" });

      await createObservation(prisma, {
        type: "camp_check",
        camp_id: "A",
        loggedBy: null,
      });

      expect(animalFindUnique).not.toHaveBeenCalled();
      expect(mobFindUnique).not.toHaveBeenCalled();
      expect(observationCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          campId: "A",
          species: "game",
        }),
      });
    });

    it("prefers animal species over mob species when both are supplied (most-specific-source-wins)", async () => {
      campFindFirst.mockResolvedValue({ campId: "A", species: "sheep" });
      animalFindUnique.mockResolvedValue({ species: "cattle" });
      observationCreate.mockResolvedValue({ id: "obs-prio" });

      await createObservation(prisma, {
        type: "weighing",
        camp_id: "A",
        animal_id: "BR-001",
        mob_id: "mob-X",
        loggedBy: null,
      });

      // Step 1 of the waterfall: animal_id wins; mob/camp lookups not
      // consulted for species.
      expect(animalFindUnique).toHaveBeenCalledTimes(1);
      expect(mobFindUnique).not.toHaveBeenCalled();
      expect(observationCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ species: "cattle" }),
      });
    });

    it("works when passed a tx-client (ObservationWriter union)", async () => {
      // Smoke test for the inside-$transaction case: pass the prisma
      // mock cast as `unknown` — the door must not depend on
      // `$transaction` being present on its `client` arg.
      const txClient = {
        observation: { create: observationCreate, upsert: observationUpsert },
        camp: { findFirst: campFindFirst },
        animal: { findUnique: animalFindUnique },
        mob: { findUnique: mobFindUnique },
      } as unknown as Parameters<typeof createObservation>[0];

      campFindFirst.mockResolvedValue({ campId: "A", species: "cattle" });
      observationCreate.mockResolvedValue({ id: "obs-tx" });

      const result = await createObservation(txClient, {
        type: "camp_check",
        camp_id: "A",
        loggedBy: null,
      });

      expect(result).toEqual({ success: true, id: "obs-tx" });
      expect(observationCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ species: "cattle" }),
      });
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
      campFindFirst.mockResolvedValue({ campId: "A", species: null });
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

  // Issue #366 — byte-identical duplicate camp_condition guard.
  //
  // Root cause: the only dedup mechanism is the `clientLocalId` upsert
  // (#206). `clientLocalId` is minted per FORM MOUNT, so two separate
  // mounts of the camp-condition form submitting identical readings carry
  // two distinct UUIDs — the upsert sees two keys and writes two
  // byte-identical "Camp condition" rows for the same camp on the same day.
  // The guard rejects a write when an existing row has the same camp, the
  // same observation day, AND an identical `details` payload — while a
  // same-day re-inspection with *different* details (a legitimate second
  // reading) and a genuine `clientLocalId` retry both still go through.
  describe("camp_condition byte-identical duplicate guard (#366)", () => {
    const DETAILS = JSON.stringify({
      grazing: "Good",
      water: "Full",
      fence: "Intact",
      logged_by: "u@x.co.za",
    });
    const DAY = "2026-05-22T09:00:00.000Z";

    beforeEach(() => {
      campFindFirst.mockResolvedValue({ campId: "A", species: null });
      observationCreate.mockResolvedValue({ id: "obs-new" });
      observationUpsert.mockResolvedValue({ id: "obs-new" });
    });

    type DupCase = {
      name: string;
      /** The row `observation.findFirst` resolves to (null = no match). */
      existing: { id: string; clientLocalId: string | null } | null;
      input: {
        details: string;
        created_at: string;
        clientLocalId?: string | null;
      };
      expect: "reject" | "accept";
    };

    const cases: DupCase[] = [
      {
        name: "rejects same camp + same day + identical details (second mount)",
        existing: { id: "obs-1", clientLocalId: "mount-1" },
        input: { details: DETAILS, created_at: DAY, clientLocalId: "mount-2" },
        expect: "reject",
      },
      {
        name: "accepts same camp + same day with DIFFERENT details (legit re-reading)",
        existing: null,
        input: {
          details: JSON.stringify({
            grazing: "Poor",
            water: "Low",
            fence: "Damaged",
            logged_by: "u@x.co.za",
          }),
          created_at: DAY,
          clientLocalId: "mount-2",
        },
        expect: "accept",
      },
      {
        name: "accepts identical details on a DIFFERENT day",
        existing: null,
        input: {
          details: DETAILS,
          created_at: "2026-05-23T09:00:00.000Z",
          clientLocalId: "mount-2",
        },
        expect: "accept",
      },
      {
        name: "accepts a clientLocalId retry — findFirst excludes the row's own clientLocalId",
        existing: null,
        input: { details: DETAILS, created_at: DAY, clientLocalId: "mount-1" },
        expect: "accept",
      },
    ];

    for (const c of cases) {
      it(c.name, async () => {
        observationFindFirst.mockResolvedValue(c.existing);

        const call = createObservation(prisma, {
          type: "camp_condition",
          camp_id: "A",
          details: c.input.details,
          created_at: c.input.created_at,
          loggedBy: "u@x.co.za",
          clientLocalId: c.input.clientLocalId ?? null,
        });

        if (c.expect === "reject") {
          await expect(call).rejects.toBeInstanceOf(DuplicateObservationError);
          expect(observationCreate).not.toHaveBeenCalled();
          expect(observationUpsert).not.toHaveBeenCalled();
        } else {
          await expect(call).resolves.toEqual({
            success: true,
            id: "obs-new",
          });
        }
      });
    }

    it("buckets the duplicate query by the tenant calendar day of observedAt", async () => {
      observationFindFirst.mockResolvedValue(null);

      await createObservation(prisma, {
        type: "camp_condition",
        camp_id: "A",
        details: DETAILS,
        created_at: DAY,
        loggedBy: "u@x.co.za",
        clientLocalId: "mount-2",
      });

      // The guard must scope the lookup to: this camp, this exact details
      // payload, the day-bucket window, the camp_condition type, and must
      // exclude the row's own clientLocalId so a genuine retry is not
      // self-rejected.
      expect(observationFindFirst).toHaveBeenCalledTimes(1);
      const where = observationFindFirst.mock.calls[0][0].where;
      expect(where.type).toBe("camp_condition");
      expect(where.campId).toBe("A");
      expect(where.details).toBe(DETAILS);
      expect(where.observedAt.gte).toBeInstanceOf(Date);
      expect(where.observedAt.lt).toBeInstanceOf(Date);
      expect(where.observedAt.lt.getTime()).toBeGreaterThan(
        where.observedAt.gte.getTime(),
      );
      // Retry-safety: the new submission's own clientLocalId is filtered out.
      expect(where.clientLocalId).toEqual({ not: "mount-2" });
    });

    it("does not run the duplicate guard for non-camp_condition types", async () => {
      await createObservation(prisma, {
        type: "camp_check",
        camp_id: "A",
        details: JSON.stringify({ status: "Normal" }),
        created_at: DAY,
        loggedBy: "u@x.co.za",
        clientLocalId: "mount-2",
      });

      expect(observationFindFirst).not.toHaveBeenCalled();
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
