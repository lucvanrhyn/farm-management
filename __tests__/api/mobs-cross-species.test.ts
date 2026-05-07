/**
 * @vitest-environment node
 *
 * __tests__/api/mobs-cross-species.test.ts
 *
 * Wave 3 / W2-C follow-up to PR #60 (#28 Phase B — cross-species hard-block):
 *   PATCH /api/mobs/[mobId] must surface 422 + `{ error: "CROSS_SPECIES_BLOCKED" }`
 *   when `performMobMove` throws `CrossSpeciesBlockedError`. PR #60 wired this
 *   contract through the animals route, but missed mobs PATCH — the error was
 *   bubbling to a 500.
 *
 *   Spec: memory/multi-species-spec-2026-04-27.md
 *     - "Hard-block animal moves across species. API rejects with typed error."
 *
 * Mirrors the response shape used by app/api/animals/[id]/route.ts so clients
 * see one consistent contract regardless of the entry point.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// vi.mock factories hoist above top-level const declarations, so any state the
// factories need must come from vi.hoisted (per memory/feedback-vi-hoisted-shared-mocks.md).
const { mobFindUniqueMock, mobUpdateMock, prismaMock, performMobMoveMock } = vi.hoisted(() => {
  const mobFindUnique = vi.fn();
  const mobUpdate = vi.fn();
  const performMobMove = vi.fn();
  const prisma = {
    mob: { findUnique: mobFindUnique, update: mobUpdate, findUniqueOrThrow: mobFindUnique },
  };
  return {
    mobFindUniqueMock: mobFindUnique,
    mobUpdateMock: mobUpdate,
    prismaMock: prisma,
    performMobMoveMock: performMobMove,
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

// Replace performMobMove so the test can throw the typed error without
// exercising the underlying Prisma transaction — the unit test for that lives
// in __tests__/server/mob-move-cross-species.test.ts.
vi.mock("@/lib/domain/mobs/move-mob", async () => {
  const actual = await vi.importActual<typeof import("@/lib/domain/mobs/move-mob")>(
    "@/lib/domain/mobs/move-mob",
  );
  return {
    ...actual,
    performMobMove: (...args: unknown[]) => performMobMoveMock(...args),
  };
});

import { PATCH } from "@/app/api/mobs/[mobId]/route";
import { CrossSpeciesBlockedError, MobNotFoundError } from "@/lib/domain/mobs/move-mob";

function patchReq(mobId: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost/api/mobs/${mobId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (mobId: string) => ({ params: Promise.resolve({ mobId }) });

describe("PATCH /api/mobs/[mobId] — cross-species guard (#28 Phase B, W2-C follow-up to PR #60)", () => {
  beforeEach(() => {
    mobFindUniqueMock.mockReset();
    mobUpdateMock.mockReset();
    performMobMoveMock.mockReset();
  });

  it("returns 422 + CROSS_SPECIES_BLOCKED when performMobMove throws CrossSpeciesBlockedError", async () => {
    mobFindUniqueMock.mockResolvedValue({
      id: "mob-1",
      name: "Mob A",
      currentCamp: "camp-source",
      species: "sheep",
    });
    performMobMoveMock.mockRejectedValue(
      new CrossSpeciesBlockedError("sheep", "cattle"),
    );

    const res = await PATCH(
      patchReq("mob-1", { currentCamp: "camp-dest" }),
      params("mob-1"),
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "CROSS_SPECIES_BLOCKED" });
    expect(mobUpdateMock).not.toHaveBeenCalled();
  });

  it("still returns 404 when performMobMove throws MobNotFoundError", async () => {
    mobFindUniqueMock.mockResolvedValue({
      id: "mob-1",
      name: "Mob A",
      currentCamp: "camp-source",
      species: "cattle",
    });
    performMobMoveMock.mockRejectedValue(new MobNotFoundError("mob-1"));

    const res = await PATCH(
      patchReq("mob-1", { currentCamp: "camp-dest" }),
      params("mob-1"),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Mob not found" });
  });

  it("succeeds (200) when performMobMove resolves cleanly (same-species move)", async () => {
    mobFindUniqueMock.mockResolvedValue({
      id: "mob-1",
      name: "Mob A",
      currentCamp: "camp-source",
      species: "cattle",
    });
    performMobMoveMock.mockResolvedValue({
      mobId: "mob-1",
      mobName: "Mob A",
      sourceCamp: "camp-source",
      destCamp: "camp-dest",
      animalIds: [],
      observedAt: new Date(),
      observationIds: ["obs-1", "obs-2"],
    });

    const res = await PATCH(
      patchReq("mob-1", { currentCamp: "camp-dest" }),
      params("mob-1"),
    );

    expect(res.status).toBe(200);
  });
});
