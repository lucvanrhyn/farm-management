/**
 * @vitest-environment node
 *
 * Wave 320 (#320 / PRD #318) — GET /api/farm is a FARM-WIDE aggregate,
 * decoupled from the ambient `farmtrack-mode` cookie.
 *
 * Regression context (Trio, 874 animals / 19 camps):
 *   `/api/farm` is a farm-wide summary endpoint. Wave 226 (#226) routed its
 *   `animalCount` / `campCount` through the species-scoped `scoped(prisma,
 *   mode)` facade, reading the per-farm `farmtrack-mode-<slug>` cookie. A
 *   client that visited under the Sheep toggle then saw 0/0 on a
 *   cattle-heavy farm — a global UI species filter is NOT safe input for a
 *   farm-wide aggregate. #320 reverses that broken assumption: the headline
 *   counts must be true farm-wide totals regardless of the cookie, matching
 *   the already-correct `getCachedFarmSummary` semantics in
 *   `lib/server/cached.ts` (`animal.count({ status: "Active" })`,
 *   `camp.count()` — "cross-species by design").
 *
 * Contract under test:
 *   - animalCount / campCount are farm-wide (every species), independent of
 *     the cookie value (cattle / sheep / game / unset).
 *   - The underlying count queries are NOT scoped by `species`.
 *
 * Pattern: mock-based, per the existing `__tests__/api/` convention
 * (mobs-cross-species.test.ts, mobs-animals-species.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { animalCountMock, campCountMock, settingsFindFirstMock, prismaMock } =
  vi.hoisted(() => {
    const animalCount = vi.fn();
    const campCount = vi.fn();
    const settingsFindFirst = vi.fn();
    const prisma = {
      animal: { count: animalCount },
      camp: { count: campCount },
      farmSettings: { findFirst: settingsFindFirst },
    };
    return {
      animalCountMock: animalCount,
      campCountMock: campCount,
      settingsFindFirstMock: settingsFindFirst,
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

// Defer cookie value to a `let` we mutate per-test; vi.hoisted lifts the
// getter ref above the import of route.ts. The whole point of #320 is that
// this value MUST NOT influence the headline counts.
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

vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

describe("GET /api/farm — farm-wide aggregate, cookie-independent (#320)", () => {
  beforeEach(() => {
    animalCountMock.mockReset();
    campCountMock.mockReset();
    settingsFindFirstMock.mockReset();
    cookieValueRef.current = "cattle";

    settingsFindFirstMock.mockResolvedValue({
      farmName: "Test Farm",
      breed: "Mixed",
      heroImageUrl: "/farm-hero.jpg",
    });

    // Models a cattle-heavy multi-species tenant (cf. Trio). A
    // species-scoped query returns the per-species slice; a farm-wide
    // query (no `species` in the where clause) returns the true total.
    animalCountMock.mockImplementation(
      async (args?: { where?: { species?: string } }) => {
        const sp = args?.where?.species;
        if (sp === "cattle") return 80;
        if (sp === "sheep") return 0; // cattle-heavy farm: no sheep
        if (sp === "game") return 5;
        // Farm-wide: caller did NOT scope by species. This is the
        // correct path for /api/farm.
        return 874;
      },
    );
    campCountMock.mockImplementation(
      async (args?: { where?: { species?: string } }) => {
        const sp = args?.where?.species;
        if (sp === "cattle") return 17;
        if (sp === "sheep") return 0;
        if (sp === "game") return 2;
        return 19;
      },
    );
  });

  it("returns farm-wide totals when the cookie is cattle", async () => {
    cookieValueRef.current = "cattle";

    const { GET } = await import("@/app/api/farm/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      animalCount: number;
      campCount: number;
    };

    expect(body.animalCount).toBe(874);
    expect(body.campCount).toBe(19);

    // The count queries MUST NOT be scoped by species.
    expect(animalCountMock.mock.calls[0][0]?.where).not.toHaveProperty(
      "species",
    );
    expect(campCountMock.mock.calls[0][0]?.where ?? {}).not.toHaveProperty(
      "species",
    );
  });

  it("returns the SAME farm-wide totals under the Sheep toggle (the Trio 0/0 regression)", async () => {
    cookieValueRef.current = "sheep";

    const { GET } = await import("@/app/api/farm/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      animalCount: number;
      campCount: number;
    };

    // Pre-#320 this returned 0 / 0 because the sheep cookie scoped the
    // count on a farm with no sheep. Farm-wide totals must be unchanged.
    expect(body.animalCount).toBe(874);
    expect(body.campCount).toBe(19);

    expect(animalCountMock.mock.calls[0][0]?.where).not.toHaveProperty(
      "species",
    );
  });

  it("returns the same farm-wide totals when no cookie is set", async () => {
    cookieValueRef.current = undefined;

    const { GET } = await import("@/app/api/farm/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      animalCount: number;
      campCount: number;
    };

    expect(body.animalCount).toBe(874);
    expect(body.campCount).toBe(19);
  });

  it("payload is identical regardless of the cookie species (cattle vs sheep vs game)", async () => {
    const get = async () => {
      const { GET } = await import("@/app/api/farm/route");
      return (await (await GET()).json()) as {
        animalCount: number;
        campCount: number;
      };
    };

    cookieValueRef.current = "cattle";
    const cattle = await get();
    cookieValueRef.current = "sheep";
    const sheep = await get();
    cookieValueRef.current = "game";
    const game = await get();

    expect(cattle).toEqual(sheep);
    expect(sheep).toEqual(game);
    expect(cattle.animalCount).toBe(874);
  });
});
