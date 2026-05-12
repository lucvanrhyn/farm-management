/**
 * @vitest-environment node
 *
 * Wave 226 — GET /api/mobs respects FarmMode (issue #226).
 *
 * Contract:
 *   - The handler reads `getFarmMode(slug)` from the per-farm cookie and
 *     scopes the mob list to `species: mode`.
 *   - Switching the cookie cattle → sheep returns a different list of
 *     mobs on the same tenant.
 *   - The "cross-species by design" comment that previously documented the
 *     farm-wide span is removed from the domain op (#28 AC).
 *
 * Pattern: mock-based, mirrors `__tests__/api/mobs-animals-species.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mobFindManyMock, animalGroupByMock, prismaMock } = vi.hoisted(() => {
  const mobFindMany = vi.fn();
  const animalGroupBy = vi.fn();
  const prisma = {
    mob: { findMany: mobFindMany },
    animal: { groupBy: animalGroupBy },
  };
  return {
    mobFindManyMock: mobFindMany,
    animalGroupByMock: animalGroupBy,
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

const { cookieValueRef } = vi.hoisted(() => ({
  cookieValueRef: { current: "cattle" as string | undefined },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => {
      if (name === "farmtrack-mode-test-farm" && cookieValueRef.current) {
        return { value: cookieValueRef.current };
      }
      return undefined;
    },
  }),
}));

vi.mock("@/lib/server/revalidate", () => ({
  revalidateMobWrite: vi.fn(),
}));

// Fixture: each mob carries a species discriminator so the mock can simulate
// a species-scoped DB read.
const ALL_MOBS = [
  { id: "m-c1", name: "Cattle Mob A", currentCamp: "C-01", species: "cattle" },
  { id: "m-c2", name: "Cattle Mob B", currentCamp: "C-02", species: "cattle" },
  { id: "m-s1", name: "Sheep Flock A", currentCamp: "S-01", species: "sheep" },
];

describe("GET /api/mobs — species-scoped list (#226)", () => {
  beforeEach(() => {
    mobFindManyMock.mockReset();
    animalGroupByMock.mockReset();
    cookieValueRef.current = "cattle";

    // Mock filters by where.species so we model the production filter.
    mobFindManyMock.mockImplementation(async (args?: { where?: { species?: string } }) => {
      const sp = args?.where?.species;
      if (!sp) return ALL_MOBS;
      return ALL_MOBS.filter((m) => m.species === sp);
    });
    // animal.groupBy: a 1:1-ish mapping with mob species for the test —
    // each mob has one Active animal.
    animalGroupByMock.mockImplementation(async (args?: { where?: { species?: string } }) => {
      const sp = args?.where?.species;
      return ALL_MOBS.filter((m) => !sp || m.species === sp).map((m) => ({
        mobId: m.id,
        _count: { _all: 1 },
      }));
    });
  });

  function getReq(): NextRequest {
    return new NextRequest("http://localhost/api/mobs");
  }

  it("returns only cattle mobs when the cookie is cattle", async () => {
    cookieValueRef.current = "cattle";

    const { GET } = await import("@/app/api/mobs/route");
    const res = await GET(getReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; name: string }>;

    expect(body.map((m) => m.id).sort()).toEqual(["m-c1", "m-c2"]);

    // findMany MUST be invoked with where.species = "cattle"
    expect(mobFindManyMock.mock.calls[0][0]?.where).toMatchObject({
      species: "cattle",
    });
  });

  it("returns only sheep mobs when the cookie is flipped to sheep", async () => {
    cookieValueRef.current = "sheep";

    const { GET } = await import("@/app/api/mobs/route");
    const res = await GET(getReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; name: string }>;

    expect(body.map((m) => m.id)).toEqual(["m-s1"]);
    expect(mobFindManyMock.mock.calls[0][0]?.where).toMatchObject({
      species: "sheep",
    });
  });

  it("animal.groupBy for counts MUST be species-scoped (no cross-species count bleed)", async () => {
    cookieValueRef.current = "sheep";
    const { GET } = await import("@/app/api/mobs/route");
    await GET(getReq(), { params: Promise.resolve({}) });

    expect(animalGroupByMock.mock.calls[0][0]?.where).toMatchObject({
      species: "sheep",
    });
  });

  it("cattle vs sheep payloads differ for the same tenant", async () => {
    cookieValueRef.current = "cattle";
    const { GET } = await import("@/app/api/mobs/route");
    const cattleBody = (await (
      await GET(getReq(), { params: Promise.resolve({}) })
    ).json()) as unknown[];

    cookieValueRef.current = "sheep";
    const sheepBody = (await (
      await GET(getReq(), { params: Promise.resolve({}) })
    ).json()) as unknown[];

    expect(cattleBody.length).not.toBe(sheepBody.length);
  });
});
