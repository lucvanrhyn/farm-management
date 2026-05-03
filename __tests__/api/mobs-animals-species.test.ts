/**
 * @vitest-environment node
 *
 * __tests__/api/mobs-animals-species.test.ts
 *
 * Wave 4 / A3 — Codex adversarial review 2026-05-02 (HIGH):
 *   POST /api/mobs/[mobId]/animals must:
 *     1. filter the `updateMany` where clause by `species: mob.species` so
 *        cross-species animals cannot be silently assigned to a mob.
 *     2. report the *actual* count of rows updated (not the request length),
 *        and surface `requested` + `mismatched` when those differ so UIs can
 *        warn the user that some animals were rejected.
 *
 *   DELETE shares the same shape — also filter on `species: mob.species`
 *   defensively in case legacy data left a cross-species animal pinned to
 *   the mob, and report the actual `{ count }`.
 *
 *   Spec: memory/multi-species-spec-2026-04-27.md — "Hard-block animal moves
 *   across species. API rejects (or filters) typed; never silently mixes."
 *
 *   Per memory/feedback-vi-hoisted-shared-mocks.md: shared mock state for
 *   vi.mock factories must come from vi.hoisted to avoid TDZ.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mobFindUniqueMock, animalUpdateManyMock, prismaMock } = vi.hoisted(() => {
  const mobFindUnique = vi.fn();
  const animalUpdateMany = vi.fn();
  const prisma = {
    mob: { findUnique: mobFindUnique },
    animal: { updateMany: animalUpdateMany },
  };
  return {
    mobFindUniqueMock: mobFindUnique,
    animalUpdateManyMock: animalUpdateMany,
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

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...actual, verifyFreshAdminRole: vi.fn().mockResolvedValue(true) };
});

vi.mock("@/lib/server/revalidate", () => ({
  revalidateMobWrite: vi.fn(),
}));

import { POST, DELETE } from "@/app/api/mobs/[mobId]/animals/route";

function postReq(mobId: string, body: { animalIds: string[] }): NextRequest {
  return new NextRequest(`http://localhost/api/mobs/${mobId}/animals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteReq(mobId: string, body: { animalIds: string[] }): NextRequest {
  return new NextRequest(`http://localhost/api/mobs/${mobId}/animals`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (mobId: string) => ({ params: Promise.resolve({ mobId }) });

describe("POST /api/mobs/[mobId]/animals — species filter + actual count (Wave 4 A3, refs #28)", () => {
  beforeEach(() => {
    mobFindUniqueMock.mockReset();
    animalUpdateManyMock.mockReset();
  });

  it("filters updateMany by mob.species so cross-species animals are silently rejected (and count reflects reality)", async () => {
    mobFindUniqueMock.mockResolvedValue({
      id: "mob-1",
      name: "Cattle Mob A",
      currentCamp: "camp-c01",
      species: "cattle",
    });
    // Caller asks for 3 animals, but only 2 are actually cattle — the third is sheep
    // and gets filtered out by the species clause. Prisma returns the real count.
    animalUpdateManyMock.mockResolvedValue({ count: 2 });

    const res = await POST(
      postReq("mob-1", { animalIds: ["A001", "A002", "S099"] }),
      params("mob-1"),
    );

    expect(res.status).toBe(200);

    // Where clause must include species: "cattle"
    expect(animalUpdateManyMock).toHaveBeenCalledTimes(1);
    const call = animalUpdateManyMock.mock.calls[0][0];
    expect(call.where).toMatchObject({
      species: "cattle",
      status: "Active",
    });
    expect(call.where.animalId).toEqual({ in: ["A001", "A002", "S099"] });

    // Response surfaces actual count, plus requested + mismatched delta so UI can warn.
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      count: 2,
      requested: 3,
      mismatched: 1,
    });
  });

  it("does not include requested/mismatched when all animals matched", async () => {
    mobFindUniqueMock.mockResolvedValue({
      id: "mob-1",
      name: "Cattle Mob A",
      currentCamp: "camp-c01",
      species: "cattle",
    });
    animalUpdateManyMock.mockResolvedValue({ count: 3 });

    const res = await POST(
      postReq("mob-1", { animalIds: ["A001", "A002", "A003"] }),
      params("mob-1"),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, count: 3 });
    // No mismatched field when nothing was filtered — keeps payload tight for the happy path.
    expect(body).not.toHaveProperty("mismatched");
    expect(body).not.toHaveProperty("requested");
  });

  it("returns 404 when mob does not exist (no updateMany call)", async () => {
    mobFindUniqueMock.mockResolvedValue(null);

    const res = await POST(
      postReq("missing-mob", { animalIds: ["A001"] }),
      params("missing-mob"),
    );

    expect(res.status).toBe(404);
    expect(animalUpdateManyMock).not.toHaveBeenCalled();
  });

  it("returns 400 when animalIds is missing or empty", async () => {
    mobFindUniqueMock.mockResolvedValue({
      id: "mob-1",
      name: "Cattle Mob A",
      currentCamp: "camp-c01",
      species: "cattle",
    });

    const res = await POST(
      postReq("mob-1", { animalIds: [] }),
      params("mob-1"),
    );

    expect(res.status).toBe(400);
    expect(animalUpdateManyMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/mobs/[mobId]/animals — species filter + actual count (Wave 4 A3)", () => {
  beforeEach(() => {
    mobFindUniqueMock.mockReset();
    animalUpdateManyMock.mockReset();
  });

  it("defensively filters by mob.species and reports actual count when legacy cross-species data exists", async () => {
    mobFindUniqueMock.mockResolvedValue({
      id: "mob-1",
      name: "Cattle Mob A",
      currentCamp: "camp-c01",
      species: "cattle",
    });
    // Legacy bug pinned a sheep to this cattle mob; DELETE only un-pins the
    // 2 cattle and reports actual count + mismatched.
    animalUpdateManyMock.mockResolvedValue({ count: 2 });

    const res = await DELETE(
      deleteReq("mob-1", { animalIds: ["A001", "A002", "S099"] }),
      params("mob-1"),
    );

    expect(res.status).toBe(200);

    expect(animalUpdateManyMock).toHaveBeenCalledTimes(1);
    const call = animalUpdateManyMock.mock.calls[0][0];
    expect(call.where).toMatchObject({
      mobId: "mob-1",
      species: "cattle",
    });
    expect(call.where.animalId).toEqual({ in: ["A001", "A002", "S099"] });
    expect(call.data).toEqual({ mobId: null });

    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      count: 2,
      requested: 3,
      mismatched: 1,
    });
  });

  it("happy-path DELETE returns count without requested/mismatched", async () => {
    mobFindUniqueMock.mockResolvedValue({
      id: "mob-1",
      name: "Cattle Mob A",
      currentCamp: "camp-c01",
      species: "cattle",
    });
    animalUpdateManyMock.mockResolvedValue({ count: 2 });

    const res = await DELETE(
      deleteReq("mob-1", { animalIds: ["A001", "A002"] }),
      params("mob-1"),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, count: 2 });
  });

  it("returns 404 when mob does not exist (no updateMany call)", async () => {
    mobFindUniqueMock.mockResolvedValue(null);

    const res = await DELETE(
      deleteReq("missing-mob", { animalIds: ["A001"] }),
      params("missing-mob"),
    );

    expect(res.status).toBe(404);
    expect(animalUpdateManyMock).not.toHaveBeenCalled();
  });
});
