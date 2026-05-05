/**
 * app/api/animals/[id]/__tests__/animals-camp-cross-species.test.ts
 *
 * TDD tests for issue #98 (Wave 2):
 *   PATCH /api/animals/[id] must reject `currentCamp` assignments when the
 *   destination camp's species does not match the animal's species. Returns
 *   422 with `{ error: "WRONG_SPECIES" }` (or `"NOT_FOUND"` when the camp
 *   simply doesn't exist).
 *
 *   Spec: memory/multi-species-spec-2026-04-27.md
 *     "each species is a fully-isolated workspace inside one tenant"
 *     "Hard-block cross-species writes uniformly"
 *
 *   Helper: lib/server/species/require-species-scoped-camp.ts (PR #123 / #116)
 *
 * Mock pattern: vi.hoisted (per memory/feedback-vi-hoisted-shared-mocks.md).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Shared mock state — vi.hoisted lifts these above the vi.mock factories below.
const {
  animalFindUniqueMock,
  animalUpdateMock,
  campFindUniqueMock,
  campFindFirstMock,
  prismaMock,
} = vi.hoisted(() => {
  const animalFindUnique = vi.fn();
  const animalUpdate = vi.fn();
  const campFindUnique = vi.fn();
  const campFindFirst = vi.fn();
  const prisma = {
    animal: { findUnique: animalFindUnique, update: animalUpdate },
    camp: { findUnique: campFindUnique, findFirst: campFindFirst },
  };
  return {
    animalFindUniqueMock: animalFindUnique,
    animalUpdateMock: animalUpdate,
    campFindUniqueMock: campFindUnique,
    campFindFirstMock: campFindFirst,
    prismaMock: prisma,
  };
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

describe("PATCH /api/animals/[id] — cross-species camp guard (#98)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    animalUpdateMock.mockResolvedValue({ id: "child-1", animalId: "C-001" });
    // Default: camp lookups return null; individual tests override.
    campFindUniqueMock.mockResolvedValue(null);
    campFindFirstMock.mockResolvedValue(null);
  });

  it("happy path — same-species camp returns 200 (regression lock for the existing flow)", async () => {
    animalFindUniqueMock.mockResolvedValue({ animalId: "C-001", species: "cattle" });
    // Helper happy-path: composite-unique findUnique returns the camp.
    campFindUniqueMock.mockResolvedValueOnce({ id: "camp-uuid-1", species: "cattle" });

    const res = await PATCH(
      patchReq("C-001", { currentCamp: "NORTH-01" }),
      params("C-001"),
    );

    expect(res.status).toBe(200);
    expect(animalUpdateMock).toHaveBeenCalledTimes(1);
    expect(animalUpdateMock.mock.calls[0][0].data.currentCamp).toBe("NORTH-01");
  });

  it("cross-species — cattle animal moved to a sheep camp returns 422 WRONG_SPECIES", async () => {
    animalFindUniqueMock.mockResolvedValue({ animalId: "C-001", species: "cattle" });
    // Helper: composite-unique miss, then findFirst returns a sheep camp.
    campFindUniqueMock.mockResolvedValueOnce(null);
    campFindFirstMock.mockResolvedValueOnce({ id: "camp-uuid-2", species: "sheep" });

    const res = await PATCH(
      patchReq("C-001", { currentCamp: "SHEEP-VELD-01" }),
      params("C-001"),
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json).toEqual({ error: "WRONG_SPECIES" });
    expect(animalUpdateMock).not.toHaveBeenCalled();
  });

  it("orphan campId — destination camp does not exist returns 422 NOT_FOUND", async () => {
    animalFindUniqueMock.mockResolvedValue({ animalId: "C-001", species: "cattle" });
    // Helper: both lookups miss → NOT_FOUND.
    campFindUniqueMock.mockResolvedValueOnce(null);
    campFindFirstMock.mockResolvedValueOnce(null);

    const res = await PATCH(
      patchReq("C-001", { currentCamp: "GHOST-99" }),
      params("C-001"),
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json).toEqual({ error: "NOT_FOUND" });
    expect(animalUpdateMock).not.toHaveBeenCalled();
  });

  it("no currentCamp in patch — guard does not run, 200 returned", async () => {
    // Patch only updates `name` — no parent or camp fields.
    const res = await PATCH(
      patchReq("C-001", { name: "Renamed" }),
      params("C-001"),
    );

    expect(res.status).toBe(200);
    // Neither the animal-species lookup nor the camp lookups should fire.
    expect(animalFindUniqueMock).not.toHaveBeenCalled();
    expect(campFindUniqueMock).not.toHaveBeenCalled();
    expect(campFindFirstMock).not.toHaveBeenCalled();
    expect(animalUpdateMock).toHaveBeenCalledTimes(1);
  });

  it("legacy null-species animal — currentCamp is allowed (mirrors existing parent-guard NULL-species lenience)", async () => {
    // TODO(#28): tighten once species backfill is verified across all tenants.
    animalFindUniqueMock.mockResolvedValue({ animalId: "L-001", species: null });

    const res = await PATCH(
      patchReq("L-001", { currentCamp: "ANY-CAMP" }),
      params("L-001"),
    );

    expect(res.status).toBe(200);
    // Helper must NOT run — child species is unknown, so we cannot type-check.
    expect(campFindUniqueMock).not.toHaveBeenCalled();
    expect(campFindFirstMock).not.toHaveBeenCalled();
    expect(animalUpdateMock).toHaveBeenCalledTimes(1);
  });

  it("combined patch — motherId AND currentCamp both in body, child species fetched ONCE (regression lock for hoisted lookup)", async () => {
    animalFindUniqueMock.mockImplementation(async ({ where }: { where: { animalId: string } }) => {
      if (where.animalId === "C-001") return { animalId: "C-001", species: "cattle" };
      if (where.animalId === "C-100") return { animalId: "C-100", species: "cattle" };
      return null;
    });
    campFindUniqueMock.mockResolvedValueOnce({ id: "camp-uuid-3", species: "cattle" });

    const res = await PATCH(
      patchReq("C-001", { motherId: "C-100", currentCamp: "NORTH-01" }),
      params("C-001"),
    );

    expect(res.status).toBe(200);
    // Critical assertion: child species lookup runs exactly once across both
    // guards. animal.findUnique is called for (1) the child species fetch and
    // (2) the parent-species fetch — total 2 calls — but NEVER 3 (which would
    // mean the child was fetched twice).
    const childLookupCalls = animalFindUniqueMock.mock.calls.filter(
      ([arg]) => arg.where.animalId === "C-001",
    );
    expect(childLookupCalls).toHaveLength(1);
    // Parent guard still ran (mother lookup happened).
    const parentLookupCalls = animalFindUniqueMock.mock.calls.filter(
      ([arg]) => arg.where.animalId === "C-100",
    );
    expect(parentLookupCalls).toHaveLength(1);
    expect(animalUpdateMock).toHaveBeenCalledTimes(1);
  });

  it("orphaned camp row (species=null) — same campId exists but species is null returns 422 WRONG_SPECIES", async () => {
    animalFindUniqueMock.mockResolvedValue({ animalId: "C-001", species: "cattle" });
    // Helper: composite-unique miss (cattle, ORPHAN), findFirst returns null-species row.
    campFindUniqueMock.mockResolvedValueOnce(null);
    campFindFirstMock.mockResolvedValueOnce({ id: "orphan-uuid", species: null });

    const res = await PATCH(
      patchReq("C-001", { currentCamp: "ORPHAN-CAMP" }),
      params("C-001"),
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json).toEqual({ error: "WRONG_SPECIES" });
    expect(animalUpdateMock).not.toHaveBeenCalled();
  });
});
