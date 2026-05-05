/**
 * @vitest-environment node
 *
 * __tests__/api/mobs-post-species.test.ts
 *
 * Wave 4 A2 — closes Codex HIGH (2026-05-02 adversarial review):
 *   "New mobs default to cattle — `app/api/mobs/route.ts` POST contract
 *    missing `species`, falls through to DB default."
 *
 * The Prisma schema sets `Mob.species @default("cattle")` as a backstop, so a
 * POST that omits `species` silently creates a CATTLE mob. A user trying to
 * create a sheep or game mob through this endpoint then runs into the #28
 * Phase B cross-species hard-block (PR #60) the moment they attempt to put a
 * sheep into the "sheep" mob — surfacing as a confusing 422 for "valid" data.
 *
 * Fix contract:
 *   - `species` is required on POST (cattle | sheep | game).
 *   - Missing or invalid `species` → 400.
 *   - `species !== camp.species` for the supplied `currentCamp` → 422 with
 *     `{ error: "CROSS_SPECIES_BLOCKED" }`, mirroring the PATCH route + the
 *     animals route, so the W4 A10 error-mapper helper can map it uniformly.
 *   - Happy path → 201 and the persisted record carries the supplied species.
 *
 * Spec: memory/multi-species-spec-2026-04-27.md
 *   - "Each species fully isolated. Hard-block cross-species moves+parents."
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// vi.mock factories hoist above top-level const declarations, so any state the
// factories need must come from vi.hoisted (per
// memory/feedback-vi-hoisted-shared-mocks.md).
//
// Wave 2 / #97 update: the route now consumes `requireSpeciesScopedCamp`
// (PR #123), which uses `prisma.camp.findUnique({ Camp_species_campId_key })`
// for the deterministic primary lookup and falls back to `findFirst` only when
// the composite-unique lookup misses. The mock surface mirrors that.
const { campFindUniqueMock, campFindFirstMock, mobCreateMock, prismaMock } = vi.hoisted(() => {
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

describe("POST /api/mobs — species contract (Wave 4 A2, refs #28)", () => {
  beforeEach(() => {
    campFindUniqueMock.mockReset();
    campFindFirstMock.mockReset();
    mobCreateMock.mockReset();
  });

  it("returns 400 when species is missing (no silent cattle default)", async () => {
    const res = await POST(
      postReq({ name: "Mob A", currentCamp: "NORTH-01" }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/species/i);
    expect(mobCreateMock).not.toHaveBeenCalled();
  });

  it("returns 400 when species is not in the registry", async () => {
    const res = await POST(
      postReq({ name: "Mob A", currentCamp: "NORTH-01", species: "ostrich" }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/species/i);
    expect(mobCreateMock).not.toHaveBeenCalled();
  });

  it("returns 422 + WRONG_SPECIES when species mismatches camp.species (#97 contract update)", async () => {
    // Composite-unique lookup misses for `(sheep, NORTH-01)`…
    campFindUniqueMock.mockResolvedValue(null);
    // …but the campId exists under cattle.
    campFindFirstMock.mockResolvedValue({ id: "camp-uuid", species: "cattle" });

    const res = await POST(
      postReq({ name: "Mob A", currentCamp: "NORTH-01", species: "sheep" }),
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "WRONG_SPECIES" });
    expect(mobCreateMock).not.toHaveBeenCalled();
  });

  it("creates the mob with the supplied species and returns 201 (happy path)", async () => {
    // Composite-unique lookup hits — the camp exists for the requested species.
    campFindUniqueMock.mockResolvedValue({ id: "camp-uuid", species: "sheep" });
    mobCreateMock.mockResolvedValue({
      id: "mob-1",
      name: "Mob A",
      currentCamp: "NORTH-01",
      species: "sheep",
    });

    const res = await POST(
      postReq({ name: "Mob A", currentCamp: "NORTH-01", species: "sheep" }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: "mob-1",
      name: "Mob A",
      current_camp: "NORTH-01",
      animal_count: 0,
    });
    // Verify species was actually persisted — the bug was that it wasn't.
    expect(mobCreateMock).toHaveBeenCalledWith({
      data: { name: "Mob A", currentCamp: "NORTH-01", species: "sheep" },
    });
  });

  it("returns 400 when name or currentCamp is missing (existing contract preserved)", async () => {
    const res = await POST(postReq({ species: "cattle" }));
    expect(res.status).toBe(400);
    expect(mobCreateMock).not.toHaveBeenCalled();
  });
});
