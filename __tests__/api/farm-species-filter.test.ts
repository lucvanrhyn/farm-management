/**
 * @vitest-environment node
 *
 * Wave 226 — GET /api/farm respects FarmMode (issue #226).
 *
 * Contract:
 *   - The handler reads `getFarmMode(slug)` from the per-farm cookie and
 *     filters animalCount + campCount by `species: mode`.
 *   - Switching the cookie from cattle → sheep on the same tenant returns
 *     a different `animalCount` / `campCount` payload (the sheep counts).
 *   - The "cross-species by design" comment that documented the previous
 *     farm-wide aggregate is removed from the data-source (#28 AC).
 *
 * Pattern: mock-based, per the existing `__tests__/api/` convention
 * (mobs-cross-species.test.ts, mobs-animals-species.test.ts). The seeded
 * Turso clone path would also work; the mock path proves the contract
 * end-to-end through the same code path with deterministic data.
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
// getter ref above the import of route.ts.
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

// The cache wrapper sits in front of the underlying counts. The 30-second
// `unstable_cache` window would interfere with per-test cookie flips, so we
// route around it the same way the route handler should once #226 lands:
// counts are computed directly in the handler via the species-scoped facade,
// and `farmSettings.findFirst` stays cached-or-direct depending on shape.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

describe("GET /api/farm — species-scoped counts (#226)", () => {
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

    // Counts are species-aware: the route must call `count({ where: { species }})`.
    // We model that by inspecting the where clause when the mock is invoked.
    animalCountMock.mockImplementation(async (args?: { where?: { species?: string } }) => {
      const sp = args?.where?.species;
      if (sp === "cattle") return 80;
      if (sp === "sheep") return 30;
      if (sp === "game") return 5;
      // Fallback — caller did NOT pass species. This branch is the bug we are fixing.
      return 115;
    });
    campCountMock.mockImplementation(async (args?: { where?: { species?: string } }) => {
      const sp = args?.where?.species;
      if (sp === "cattle") return 12;
      if (sp === "sheep") return 4;
      if (sp === "game") return 2;
      return 18;
    });
  });

  it("returns cattle counts when the FarmMode cookie is cattle", async () => {
    cookieValueRef.current = "cattle";

    const { GET } = await import("@/app/api/farm/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { animalCount: number; campCount: number };

    expect(body.animalCount).toBe(80);
    expect(body.campCount).toBe(12);

    // Counts MUST be called with species: "cattle" so the audit and the
    // per-species page see byte-identical numbers.
    const animalCalls = animalCountMock.mock.calls;
    expect(animalCalls.length).toBeGreaterThan(0);
    expect(animalCalls[0][0]?.where).toMatchObject({ species: "cattle" });
  });

  it("returns sheep counts when the cookie is flipped to sheep", async () => {
    cookieValueRef.current = "sheep";

    const { GET } = await import("@/app/api/farm/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { animalCount: number; campCount: number };

    expect(body.animalCount).toBe(30);
    expect(body.campCount).toBe(4);

    expect(animalCountMock.mock.calls[0][0]?.where).toMatchObject({
      species: "sheep",
    });
    expect(campCountMock.mock.calls[0][0]?.where).toMatchObject({
      species: "sheep",
    });
  });

  it("defaults to cattle when no cookie is set (getFarmMode fallback)", async () => {
    cookieValueRef.current = undefined;

    const { GET } = await import("@/app/api/farm/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { animalCount: number; campCount: number };

    expect(body.animalCount).toBe(80);
    expect(body.campCount).toBe(12);
  });

  it("cattle vs sheep payloads differ for the same tenant", async () => {
    cookieValueRef.current = "cattle";
    const { GET } = await import("@/app/api/farm/route");
    const cattleBody = (await (await GET()).json()) as { animalCount: number };

    cookieValueRef.current = "sheep";
    const sheepBody = (await (await GET()).json()) as { animalCount: number };

    expect(cattleBody.animalCount).not.toBe(sheepBody.animalCount);
  });
});
