/**
 * __tests__/api/animals-parent-cross-species.test.ts
 *
 * TDD tests for wave/58 (#28 Phase B — cross-species hard-block runtime guard):
 *   PATCH /api/animals/[id] must reject motherId/fatherId assignments when the
 *   parent animal's species does not match the child animal's species. Returns
 *   422 with `{ error: "CROSS_SPECIES_BLOCKED" }`.
 *
 *   Spec: memory/multi-species-spec-2026-04-27.md
 *     - "Cross-species parent constraint — at write time, validate
 *        Animal.motherId and Animal.fatherId resolve to animals with matching
 *        species. Reject otherwise. Same rigor as camp moves."
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// vi.mock factories hoist above top-level const declarations, so any state the
// factories need must come from vi.hoisted (per memory/feedback-vi-hoisted-shared-mocks.md).
const { findUniqueMock, updateMock, prismaMock } = vi.hoisted(() => {
  const findUnique = vi.fn();
  const update = vi.fn();
  const prisma = {
    animal: { findUnique, update },
  };
  return { findUniqueMock: findUnique, updateMock: update, prismaMock: prisma };
});

vi.mock("@/lib/server/farm-context", () => ({
  getFarmContext: vi.fn().mockResolvedValue({
    prisma: prismaMock,
    role: "ADMIN",
    slug: "test-farm",
    session: { user: { id: "user-1", email: "test@farm.co.za" } },
  }),
}));

vi.mock("@/lib/server/revalidate", () => ({
  revalidateAnimalWrite: vi.fn(),
}));

import { PATCH } from "@/app/api/animals/[id]/route";

function patchReq(id: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost/api/animals/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("PATCH /api/animals/[id] — cross-species parent guard (#28 Phase B)", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    updateMock.mockReset();
    updateMock.mockResolvedValue({ id: "child-1", animalId: "C-001" });
  });

  it("rejects motherId assignment when child is cattle and mother is sheep with 422 CROSS_SPECIES_BLOCKED", async () => {
    findUniqueMock.mockImplementation(async ({ where }: { where: { animalId: string } }) => {
      if (where.animalId === "C-001") return { animalId: "C-001", species: "cattle" };
      if (where.animalId === "S-100") return { animalId: "S-100", species: "sheep" };
      return null;
    });

    const res = await PATCH(patchReq("C-001", { motherId: "S-100" }), params("C-001"));

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json).toEqual({ error: "CROSS_SPECIES_BLOCKED" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects fatherId assignment when species mismatch with 422 CROSS_SPECIES_BLOCKED", async () => {
    findUniqueMock.mockImplementation(async ({ where }: { where: { animalId: string } }) => {
      if (where.animalId === "G-001") return { animalId: "G-001", species: "game" };
      if (where.animalId === "C-200") return { animalId: "C-200", species: "cattle" };
      return null;
    });

    const res = await PATCH(patchReq("G-001", { fatherId: "C-200" }), params("G-001"));

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json).toEqual({ error: "CROSS_SPECIES_BLOCKED" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("allows motherId assignment when both animals are the same species", async () => {
    findUniqueMock.mockImplementation(async ({ where }: { where: { animalId: string } }) => {
      if (where.animalId === "C-001") return { animalId: "C-001", species: "cattle" };
      if (where.animalId === "C-100") return { animalId: "C-100", species: "cattle" };
      return null;
    });

    const res = await PATCH(patchReq("C-001", { motherId: "C-100" }), params("C-001"));

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0].data.motherId).toBe("C-100");
  });

  it("allows the assignment when either animal has NULL species (legacy data, treat as 'unknown, allow' with TODO)", async () => {
    findUniqueMock.mockImplementation(async ({ where }: { where: { animalId: string } }) => {
      if (where.animalId === "C-001") return { animalId: "C-001", species: "cattle" };
      // legacy row with no species column populated yet
      if (where.animalId === "L-100") return { animalId: "L-100", species: null };
      return null;
    });

    const res = await PATCH(patchReq("C-001", { motherId: "L-100" }), params("C-001"));

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("returns 422 CROSS_SPECIES_BLOCKED when the parent animal does not exist", async () => {
    // A motherId that resolves to nothing is a different kind of failure than
    // species mismatch. We surface 404-style error to keep the API honest —
    // but we never silently swallow.
    findUniqueMock.mockImplementation(async ({ where }: { where: { animalId: string } }) => {
      if (where.animalId === "C-001") return { animalId: "C-001", species: "cattle" };
      return null;
    });

    const res = await PATCH(patchReq("C-001", { motherId: "MISSING" }), params("C-001"));

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json).toEqual({ error: "PARENT_NOT_FOUND" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("does not run the species check when no parent fields are in the patch (no extra DB reads)", async () => {
    findUniqueMock.mockResolvedValue({ animalId: "C-001", species: "cattle" });

    const res = await PATCH(patchReq("C-001", { name: "Renamed" }), params("C-001"));

    expect(res.status).toBe(200);
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledTimes(1);
  });
});
