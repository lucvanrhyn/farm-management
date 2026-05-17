/**
 * @vitest-environment node
 *
 * Wave 309b (ADR-0001 Wave B, #309) — domain op: `updateAnimal`.
 *
 * The entire PATCH body of `app/api/animals/[id]` lifted verbatim:
 *   role gate (LOGGER allowlist / non-ADMIN deny)
 *   → enum validation (status, sex)
 *   → field allowlist projection
 *   → #28 cross-species parent guard (ordered, NULL-species lenient)
 *   → #98 cross-species camp guard (only when child species known)
 *   → prisma.animal.update
 *
 * Every business-rule violation throws a typed error; the route adapter
 * maps each one onto the byte-identical legacy wire shape via
 * `mapApiDomainError`. The op itself is pure (mocked Prisma + a mocked
 * `requireSpeciesScopedCamp`).
 *
 * Hoisted single-read invariant: with zero parent fields and no camp
 * move, the op MUST issue NO `findUnique` (the existing
 * `__tests__/api/animals-parent-cross-species.test.ts` baseline asserts
 * `findUniqueMock` is never called for a name-only patch).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

const { requireSpeciesScopedCampMock } = vi.hoisted(() => ({
  requireSpeciesScopedCampMock: vi.fn(),
}));

vi.mock("@/lib/server/species/require-species-scoped-camp", () => ({
  requireSpeciesScopedCamp: requireSpeciesScopedCampMock,
}));

import { updateAnimal } from "../update-animal";
import {
  AnimalFieldForbiddenError,
  InvalidAnimalFieldError,
  ParentNotFoundError,
  SpeciesScopedCampError,
} from "../errors";
import { CrossSpeciesBlockedError } from "@/lib/domain/mobs/move-mob";

const animalFindUnique = vi.fn();
const animalUpdate = vi.fn();
const prisma = {
  animal: { findUnique: animalFindUnique, update: animalUpdate },
} as unknown as PrismaClient;

function call(
  role: "ADMIN" | "LOGGER" | "VIEWER",
  animalId: string,
  body: Record<string, unknown>,
) {
  return updateAnimal(prisma, {
    animalId,
    role,
    slug: "test-farm",
    body,
  });
}

beforeEach(() => {
  animalFindUnique.mockReset();
  animalUpdate.mockReset();
  animalUpdate.mockResolvedValue({ id: "child-1", animalId: "C-001" });
  requireSpeciesScopedCampMock.mockReset();
});

describe("updateAnimal — authorization matrix", () => {
  it("ADMIN may update the full field allowlist", async () => {
    await call("ADMIN", "C-001", {
      name: "Bessie",
      sex: "Female",
      dateOfBirth: "2020-01-01",
      breed: "Brangus",
      category: "Cow",
      currentCamp: "North",
      status: "Active",
      registrationNumber: "R-1",
      deceasedAt: null,
      tagNumber: "T-1",
      brandSequence: "B-1",
    });
    // currentCamp present but no child species lookup needed unless the
    // guard branch runs; camp guard only fires when child species known.
    expect(animalUpdate).toHaveBeenCalledTimes(1);
    const data = animalUpdate.mock.calls[0][0].data;
    expect(data).toEqual({
      name: "Bessie",
      sex: "Female",
      dateOfBirth: "2020-01-01",
      breed: "Brangus",
      category: "Cow",
      currentCamp: "North",
      status: "Active",
      registrationNumber: "R-1",
      deceasedAt: null,
      tagNumber: "T-1",
      brandSequence: "B-1",
    });
  });

  it("LOGGER may update only status / deceasedAt / currentCamp", async () => {
    // currentCamp present → hoisted child read; species null → camp guard skipped.
    animalFindUnique.mockResolvedValue({ species: null });

    await call("LOGGER", "C-001", {
      status: "Deceased",
      deceasedAt: "2026-05-17",
      currentCamp: "Sick-Bay",
    });

    expect(animalUpdate).toHaveBeenCalledTimes(1);
    expect(animalUpdate.mock.calls[0][0].data).toEqual({
      status: "Deceased",
      deceasedAt: "2026-05-17",
      currentCamp: "Sick-Bay",
    });
  });

  it("LOGGER with a disallowed key throws AnimalFieldForbiddenError", async () => {
    await expect(
      call("LOGGER", "C-001", { name: "Hax" }),
    ).rejects.toBeInstanceOf(AnimalFieldForbiddenError);
    expect(animalUpdate).not.toHaveBeenCalled();
  });

  it("LOGGER with a mix of allowed + disallowed keys is forbidden", async () => {
    await expect(
      call("LOGGER", "C-001", { status: "Sold", breed: "X" }),
    ).rejects.toBeInstanceOf(AnimalFieldForbiddenError);
    expect(animalUpdate).not.toHaveBeenCalled();
  });

  it("a non-ADMIN non-LOGGER role is forbidden outright", async () => {
    await expect(
      call("VIEWER", "C-001", { status: "Active" }),
    ).rejects.toBeInstanceOf(AnimalFieldForbiddenError);
    expect(animalUpdate).not.toHaveBeenCalled();
  });
});

describe("updateAnimal — enum validation (legacy free-text messages)", () => {
  it("rejects an invalid status with the byte-identical message", async () => {
    await expect(
      call("ADMIN", "C-001", { status: "Zombie" }),
    ).rejects.toMatchObject({
      message: "status must be one of: Active, Deceased, Sold, Culled",
    });
    await expect(
      call("ADMIN", "C-001", { status: "Zombie" }),
    ).rejects.toBeInstanceOf(InvalidAnimalFieldError);
    expect(animalUpdate).not.toHaveBeenCalled();
  });

  it("rejects an invalid sex with the byte-identical message", async () => {
    await expect(
      call("ADMIN", "C-001", { sex: "Helicopter" }),
    ).rejects.toMatchObject({
      message: "sex must be one of: Male, Female, Unknown",
    });
    await expect(
      call("ADMIN", "C-001", { sex: "Helicopter" }),
    ).rejects.toBeInstanceOf(InvalidAnimalFieldError);
    expect(animalUpdate).not.toHaveBeenCalled();
  });

  it("accepts every valid status", async () => {
    for (const status of ["Active", "Deceased", "Sold", "Culled"]) {
      animalUpdate.mockClear();
      await call("ADMIN", "C-001", { status });
      expect(animalUpdate).toHaveBeenCalledTimes(1);
    }
  });
});

describe("updateAnimal — field allowlist projection", () => {
  it("drops keys outside the allowlist (e.g. arbitrary columns)", async () => {
    await call("ADMIN", "C-001", {
      name: "Keep",
      hacked: "drop-me",
      id: "drop-me-too",
      species: "drop-me-three",
    });

    expect(animalUpdate.mock.calls[0][0].data).toEqual({ name: "Keep" });
  });

  it("targets the row by its unique animalId", async () => {
    await call("ADMIN", "C-001", { name: "X" });
    expect(animalUpdate).toHaveBeenCalledWith({
      where: { animalId: "C-001" },
      data: { name: "X" },
    });
  });
});

describe("updateAnimal — hoisted single read + guard gating", () => {
  it("does NO findUnique when there are no parent fields and no camp move", async () => {
    await call("ADMIN", "C-001", { name: "Renamed" });
    expect(animalFindUnique).not.toHaveBeenCalled();
    expect(animalUpdate).toHaveBeenCalledTimes(1);
  });

  it("issues exactly ONE child-species read shared by parent + camp guards", async () => {
    animalFindUnique.mockImplementation(
      async ({ where }: { where: { animalId: string } }) => {
        if (where.animalId === "C-001") return { species: "cattle" };
        if (where.animalId === "C-100") return { species: "cattle" };
        return null;
      },
    );
    requireSpeciesScopedCampMock.mockResolvedValue({ ok: true });

    await call("ADMIN", "C-001", {
      motherId: "C-100",
      currentCamp: "North",
    });

    // One read for the child + one for the parent = 2 total; the child
    // read is hoisted (issued once, not once-per-guard).
    const childReads = animalFindUnique.mock.calls.filter(
      (c) =>
        c[0].where.animalId === "C-001" &&
        c[0].select?.species === true,
    );
    expect(childReads).toHaveLength(1);
  });
});

describe("updateAnimal — #28 cross-species parent guard", () => {
  it("throws ParentNotFoundError when the parent does not exist", async () => {
    animalFindUnique.mockImplementation(
      async ({ where }: { where: { animalId: string } }) => {
        if (where.animalId === "C-001") return { species: "cattle" };
        return null;
      },
    );

    await expect(
      call("ADMIN", "C-001", { motherId: "MISSING" }),
    ).rejects.toBeInstanceOf(ParentNotFoundError);
    expect(animalUpdate).not.toHaveBeenCalled();
  });

  it("throws CrossSpeciesBlockedError on a species mismatch", async () => {
    animalFindUnique.mockImplementation(
      async ({ where }: { where: { animalId: string } }) => {
        if (where.animalId === "C-001") return { species: "cattle" };
        if (where.animalId === "S-100") return { species: "sheep" };
        return null;
      },
    );

    await expect(
      call("ADMIN", "C-001", { motherId: "S-100" }),
    ).rejects.toBeInstanceOf(CrossSpeciesBlockedError);
    expect(animalUpdate).not.toHaveBeenCalled();
  });

  it("allows a same-species parent", async () => {
    animalFindUnique.mockImplementation(
      async ({ where }: { where: { animalId: string } }) => {
        if (where.animalId === "C-001") return { species: "cattle" };
        if (where.animalId === "C-100") return { species: "cattle" };
        return null;
      },
    );

    await call("ADMIN", "C-001", { motherId: "C-100" });
    expect(animalUpdate).toHaveBeenCalledTimes(1);
    expect(animalUpdate.mock.calls[0][0].data.motherId).toBe("C-100");
  });

  it("is lenient when the CHILD species is NULL (legacy data)", async () => {
    animalFindUnique.mockImplementation(
      async ({ where }: { where: { animalId: string } }) => {
        if (where.animalId === "C-001") return { species: null };
        if (where.animalId === "S-100") return { species: "sheep" };
        return null;
      },
    );

    await call("ADMIN", "C-001", { motherId: "S-100" });
    expect(animalUpdate).toHaveBeenCalledTimes(1);
  });

  it("is lenient when the PARENT species is NULL (legacy data)", async () => {
    animalFindUnique.mockImplementation(
      async ({ where }: { where: { animalId: string } }) => {
        if (where.animalId === "C-001") return { species: "cattle" };
        if (where.animalId === "L-100") return { species: null };
        return null;
      },
    );

    await call("ADMIN", "C-001", { motherId: "L-100" });
    expect(animalUpdate).toHaveBeenCalledTimes(1);
  });

  it("checks motherId before fatherId (guard ordering — mother fails first)", async () => {
    animalFindUnique.mockImplementation(
      async ({ where }: { where: { animalId: string } }) => {
        if (where.animalId === "C-001") return { species: "cattle" };
        return null; // both parents missing
      },
    );

    // motherId resolves to null first → ParentNotFoundError before
    // fatherId is even examined.
    await expect(
      call("ADMIN", "C-001", { motherId: "M-X", fatherId: "F-X" }),
    ).rejects.toBeInstanceOf(ParentNotFoundError);
  });

  it("ignores falsy parent ids (clearing motherId is not a guard trigger)", async () => {
    await call("ADMIN", "C-001", { motherId: null });
    // motherId:null is falsy → parent guard not triggered → no child read.
    expect(animalFindUnique).not.toHaveBeenCalled();
    expect(animalUpdate.mock.calls[0][0].data).toEqual({ motherId: null });
  });
});

describe("updateAnimal — #98 cross-species camp guard", () => {
  it("calls requireSpeciesScopedCamp only when child species is known", async () => {
    animalFindUnique.mockResolvedValue({ species: "cattle" });
    requireSpeciesScopedCampMock.mockResolvedValue({ ok: true });

    await call("ADMIN", "C-001", { currentCamp: "North" });

    expect(requireSpeciesScopedCampMock).toHaveBeenCalledWith(prisma, {
      species: "cattle",
      farmSlug: "test-farm",
      campId: "North",
    });
    expect(animalUpdate).toHaveBeenCalledTimes(1);
  });

  it("SKIPS the camp guard when child species is NULL (legacy lenience)", async () => {
    animalFindUnique.mockResolvedValue({ species: null });

    await call("ADMIN", "C-001", { currentCamp: "North" });

    expect(requireSpeciesScopedCampMock).not.toHaveBeenCalled();
    expect(animalUpdate).toHaveBeenCalledTimes(1);
  });

  it("throws SpeciesScopedCampError(NOT_FOUND) when the camp is missing", async () => {
    animalFindUnique.mockResolvedValue({ species: "cattle" });
    requireSpeciesScopedCampMock.mockResolvedValue({
      ok: false,
      reason: "NOT_FOUND",
    });

    await expect(
      call("ADMIN", "C-001", { currentCamp: "Ghost" }),
    ).rejects.toMatchObject({ reason: "NOT_FOUND" });
    await expect(
      call("ADMIN", "C-001", { currentCamp: "Ghost" }),
    ).rejects.toBeInstanceOf(SpeciesScopedCampError);
    expect(animalUpdate).not.toHaveBeenCalled();
  });

  it("throws SpeciesScopedCampError(WRONG_SPECIES) when the camp is another species", async () => {
    animalFindUnique.mockResolvedValue({ species: "cattle" });
    requireSpeciesScopedCampMock.mockResolvedValue({
      ok: false,
      reason: "WRONG_SPECIES",
    });

    await expect(
      call("ADMIN", "C-001", { currentCamp: "Sheep-Paddock" }),
    ).rejects.toMatchObject({ reason: "WRONG_SPECIES" });
    expect(animalUpdate).not.toHaveBeenCalled();
  });

  it("does NOT run the camp guard when currentCamp is falsy", async () => {
    await call("ADMIN", "C-001", { currentCamp: "" });
    expect(animalFindUnique).not.toHaveBeenCalled();
    expect(requireSpeciesScopedCampMock).not.toHaveBeenCalled();
    expect(animalUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("updateAnimal — happy path", () => {
  it("returns the updated animal row", async () => {
    const row = { id: "child-1", animalId: "C-001", name: "Final" };
    animalUpdate.mockResolvedValue(row);

    const result = await call("ADMIN", "C-001", { name: "Final" });
    expect(result).toBe(row);
  });
});
