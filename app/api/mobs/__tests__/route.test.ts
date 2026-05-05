/**
 * @vitest-environment node
 *
 * app/api/mobs/__tests__/route.test.ts
 *
 * Wave 2 / #97 — POST /api/mobs orphan-camp + non-deterministic dup-campId guard.
 *
 * The previous implementation used `findFirst({ where: { campId } })` to look up
 * the destination camp and infer its species. Two defects fell out of that:
 *
 *   1. Non-deterministic across duplicate campIds: Phase A of #28 made `campId`
 *      per-species-scoped, so the same string can legitimately exist for both
 *      `cattle` and `sheep`. `findFirst` with no `orderBy` is a coin flip — the
 *      cross-species check could pass or fail depending on row insertion order.
 *
 *   2. Orphan camp passes through: when no row matched at all (`destCamp` was
 *      `null`), the create proceeded silently — a mob with `currentCamp`
 *      pointing at nothing.
 *
 * Fix: replace the inline lookup with `requireSpeciesScopedCamp` (PR #123),
 * which uses the composite-unique key `(species, campId)` for a deterministic
 * primary lookup and falls back to a secondary `findFirst({ where: { campId } })`
 * to distinguish NOT_FOUND from WRONG_SPECIES.
 *
 * Spec: memory/multi-species-spec-2026-04-27.md
 *   "each species fully isolated, hard-block cross-species writes uniformly"
 *
 * Error contract (changes from the previous CROSS_SPECIES_BLOCKED single-error):
 *   - 422 `{ error: "WRONG_SPECIES" }` — camp exists under a different species
 *     (including legacy orphaned rows where `species` is null).
 *   - 422 `{ error: "NOT_FOUND" }` — no camp with that `campId` exists at all.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// vi.mock factories hoist above top-level const declarations, so any state the
// factories need must come from vi.hoisted (per
// memory/feedback-vi-hoisted-shared-mocks.md).
const {
  campFindUniqueMock,
  campFindFirstMock,
  mobCreateMock,
  prismaMock,
} = vi.hoisted(() => {
  const campFindUnique = vi.fn();
  const campFindFirst = vi.fn();
  const mobCreate = vi.fn();
  const prisma = {
    camp: { findUnique: campFindUnique, findFirst: campFindFirst },
    mob: { create: mobCreate },
  };
  return {
    campFindUniqueMock: campFindUnique,
    campFindFirstMock: campFindFirst,
    mobCreateMock: mobCreate,
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

import { POST } from "@/app/api/mobs/route";

function postReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/mobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mobs — orphan + cross-species camp guard (#97)", () => {
  beforeEach(() => {
    campFindUniqueMock.mockReset();
    campFindFirstMock.mockReset();
    mobCreateMock.mockReset();
  });

  it("happy path: same-species camp resolves via composite-unique lookup → 201", async () => {
    // Primary composite-unique lookup hits — camp exists for the requested species.
    campFindUniqueMock.mockResolvedValue({ id: "camp-uuid-1", species: "cattle" });
    mobCreateMock.mockResolvedValue({
      id: "mob-1",
      name: "Mob A",
      currentCamp: "NORTH-01",
      species: "cattle",
    });

    const res = await POST(
      postReq({ name: "Mob A", currentCamp: "NORTH-01", species: "cattle" }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: "mob-1",
      name: "Mob A",
      current_camp: "NORTH-01",
      animal_count: 0,
    });
    // The fallback `findFirst` must NOT fire on the happy path.
    expect(campFindFirstMock).not.toHaveBeenCalled();
    expect(mobCreateMock).toHaveBeenCalledWith({
      data: { name: "Mob A", currentCamp: "NORTH-01", species: "cattle" },
    });
  });

  it("returns 422 + WRONG_SPECIES when the destination camp belongs to a different species", async () => {
    // Composite-unique lookup misses (no cattle camp with this campId)…
    campFindUniqueMock.mockResolvedValue(null);
    // …but the same campId exists under sheep.
    campFindFirstMock.mockResolvedValue({ id: "camp-uuid-2", species: "sheep" });

    const res = await POST(
      postReq({ name: "Mob A", currentCamp: "SHARED-01", species: "cattle" }),
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "WRONG_SPECIES" });
    expect(mobCreateMock).not.toHaveBeenCalled();
  });

  it("returns 422 + NOT_FOUND when the campId does not exist anywhere (orphan move)", async () => {
    // Composite-unique lookup misses…
    campFindUniqueMock.mockResolvedValue(null);
    // …and no row exists for this campId at all.
    campFindFirstMock.mockResolvedValue(null);

    const res = await POST(
      postReq({ name: "Mob A", currentCamp: "GHOST-99", species: "cattle" }),
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "NOT_FOUND" });
    expect(mobCreateMock).not.toHaveBeenCalled();
  });

  it("is deterministic when the same campId exists for multiple species (composite-unique key)", async () => {
    // Both `cattle` and `sheep` rows exist with campId = "DUP-01". Without
    // species in the lookup the previous `findFirst` was a coin flip. With the
    // composite-unique lookup, the cattle request lands on the cattle row
    // deterministically.
    campFindUniqueMock.mockImplementation(
      ({ where }: { where: { Camp_species_campId_key: { species: string; campId: string } } }) => {
        const { species, campId } = where.Camp_species_campId_key;
        if (species === "cattle" && campId === "DUP-01") {
          return Promise.resolve({ id: "cattle-row", species: "cattle" });
        }
        if (species === "sheep" && campId === "DUP-01") {
          return Promise.resolve({ id: "sheep-row", species: "sheep" });
        }
        return Promise.resolve(null);
      },
    );
    mobCreateMock.mockResolvedValue({
      id: "mob-2",
      name: "Cattle Mob",
      currentCamp: "DUP-01",
      species: "cattle",
    });

    const res = await POST(
      postReq({ name: "Cattle Mob", currentCamp: "DUP-01", species: "cattle" }),
    );

    expect(res.status).toBe(201);
    // Confirm the composite-unique lookup was used (not findFirst on campId alone).
    expect(campFindUniqueMock).toHaveBeenCalledWith({
      where: { Camp_species_campId_key: { species: "cattle", campId: "DUP-01" } },
      select: { id: true, species: true },
    });
    expect(campFindFirstMock).not.toHaveBeenCalled();
  });

  it("returns 422 + WRONG_SPECIES for legacy orphaned rows where camp.species is null", async () => {
    // Composite-unique lookup misses (no row with species='cattle' for this campId)…
    campFindUniqueMock.mockResolvedValue(null);
    // …but a legacy row exists with species=null (pre-Phase-A multi-species data).
    // The helper treats `null` as "different species" — caller must hard-block.
    campFindFirstMock.mockResolvedValue({ id: "legacy-uuid", species: null });

    const res = await POST(
      postReq({ name: "Mob A", currentCamp: "LEGACY-01", species: "cattle" }),
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "WRONG_SPECIES" });
    expect(mobCreateMock).not.toHaveBeenCalled();
  });
});
