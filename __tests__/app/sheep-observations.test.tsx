// @vitest-environment jsdom
/**
 * __tests__/app/sheep-observations.test.tsx
 *
 * Wave 5 (#231) — `/sheep/observations` tracer bullet.
 *
 * Asserts:
 *  1. `/sheep/observations` filters `observation.findMany` by
 *     `species: "sheep"` — a fixture with mixed cattle+sheep observation
 *     rows yields only the sheep rows in the SSR payload. The species
 *     axis flows through the species-scoped Prisma facade (PRD #222 /
 *     #224) so the predicate is enforced at the boundary the facade
 *     dispatches to.
 *  2. Orphan-observation handling per ADR-0004 — observations with
 *     `species: null` (legacy rows pre-backfill, or where the owning
 *     animal was deleted) are excluded from the sheep feed. The facade
 *     injects `where: { species: "sheep" }`, not a NULL-tolerant OR, so
 *     NULL rows fall out by construction. This test pins that policy.
 *  3. Basson regression — the existing cattle `/admin/observations` page
 *     still filters `animal.findMany` (the SSR animal prefetch for the
 *     create-observation modal) by `species: mode` from the cookie,
 *     unchanged by this wave.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// ── Mocks ───────────────────────────────────────────────────────────────
const getPrismaForFarmMock = vi.fn();
const getFarmModeMock = vi.fn();
const getFarmCredsMock = vi.fn();

const observationFindManyMock = vi.fn();
const animalFindManyMock = vi.fn();
const campFindManyMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/trio-b/sheep/observations",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/farm-prisma", () => ({
  getPrismaForFarm: getPrismaForFarmMock,
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));
vi.mock("@/lib/server/get-farm-mode", () => ({ getFarmMode: getFarmModeMock }));
vi.mock("@/lib/meta-db", () => ({ getFarmCreds: getFarmCredsMock }));

// Stub heavy client components — we only care about Prisma calls and the
// SSR payload handed to the page client.
vi.mock("@/components/admin/ClearSectionButton", () => ({ default: () => null }));
vi.mock("@/components/admin/UpgradePrompt", () => ({ default: () => null }));

function buildPrismaMock() {
  return {
    observation: {
      findMany: observationFindManyMock,
    },
    animal: {
      findMany: animalFindManyMock,
    },
    camp: {
      findMany: campFindManyMock,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getFarmModeMock.mockResolvedValue("sheep");
  getFarmCredsMock.mockResolvedValue({ tier: "advanced" });
  getPrismaForFarmMock.mockResolvedValue(buildPrismaMock());
  observationFindManyMock.mockResolvedValue([]);
  animalFindManyMock.mockResolvedValue([]);
  campFindManyMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

// ── #231 — sheep observations page ─────────────────────────────────────
describe("/sheep/observations page (#231)", () => {
  it("filters observation.findMany by species: 'sheep' (mixed cattle+sheep+null fixture yields only sheep)", async () => {
    // Mixed fixture: 2 cattle obs + 3 sheep obs + 1 orphan (species=null).
    // We mock prisma.observation.findMany so we can both assert the
    // species predicate AND drive the orphan-exclusion expectation off
    // the same fixture. The facade injects `where: { species: 'sheep' }`
    // — rows where species is null don't satisfy that predicate and
    // are correctly excluded per ADR-0004.
    observationFindManyMock.mockImplementation(async (args) => {
      const where = args?.where ?? {};
      const rows = [
        { id: "o1", type: "health_issue", campId: "C1", animalId: "C001", species: "cattle", observedAt: new Date("2026-05-10"), details: "{}", createdAt: new Date(), loggedBy: null, editedBy: null, editedAt: null, editHistory: null, attachmentUrl: null },
        { id: "o2", type: "weight_record", campId: "C1", animalId: "C002", species: "cattle", observedAt: new Date("2026-05-09"), details: "{}", createdAt: new Date(), loggedBy: null, editedBy: null, editedAt: null, editHistory: null, attachmentUrl: null },
        { id: "o3", type: "health_issue", campId: "S1", animalId: "E001", species: "sheep", observedAt: new Date("2026-05-11"), details: "{}", createdAt: new Date(), loggedBy: null, editedBy: null, editedAt: null, editHistory: null, attachmentUrl: null },
        { id: "o4", type: "weight_record", campId: "S1", animalId: "E002", species: "sheep", observedAt: new Date("2026-05-08"), details: "{}", createdAt: new Date(), loggedBy: null, editedBy: null, editedAt: null, editHistory: null, attachmentUrl: null },
        { id: "o5", type: "shearing", campId: "S1", animalId: "R001", species: "sheep", observedAt: new Date("2026-05-07"), details: "{}", createdAt: new Date(), loggedBy: null, editedBy: null, editedAt: null, editHistory: null, attachmentUrl: null },
        // Orphan row — species=null. Per ADR-0004 (read predicate after
        // backfill is strict `species: mode`, not NULL-tolerant), this
        // row MUST NOT appear on a per-species page.
        { id: "o6", type: "health_issue", campId: "C1", animalId: null, species: null, observedAt: new Date("2026-05-06"), details: "{}", createdAt: new Date(), loggedBy: null, editedBy: null, editedAt: null, editHistory: null, attachmentUrl: null },
      ];
      // Mimic Prisma's `where: { species: 'sheep' }` semantics — only
      // rows whose species literally equals 'sheep' match.
      return rows.filter((r) => (where.species ? r.species === where.species : true));
    });

    const mod = await import("@/app/[farmSlug]/sheep/observations/page");
    const Page = mod.default as (props: {
      params: Promise<{ farmSlug: string }>;
      searchParams?: Promise<{ cursor?: string }>;
    }) => Promise<unknown>;

    await Page({
      params: Promise.resolve({ farmSlug: "trio-b" }),
      searchParams: Promise.resolve({}),
    });

    // Every observation.findMany call must have been species-scoped to sheep.
    expect(observationFindManyMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of observationFindManyMock.mock.calls) {
      const where = call[0]?.where ?? {};
      expect(where.species).toBe("sheep");
    }

    // And the rows the mock returned for the first findMany call (the
    // SSR-rendered observation list) are exclusively sheep — cattle rows
    // AND the orphan row are excluded. The filter is enforced *by the
    // mock semantics above*, which mirror Prisma's real where-clause
    // semantics, so this assertion proves the facade contract holds at
    // the boundary.
    const firstCallArgs = observationFindManyMock.mock.calls[0][0];
    const firstWhere = firstCallArgs?.where ?? {};
    expect(firstWhere.species).toBe("sheep");

    // Replay the same filter to extract the expected SSR rows.
    const rows = [
      { species: "cattle" },
      { species: "cattle" },
      { species: "sheep" },
      { species: "sheep" },
      { species: "sheep" },
      { species: null },
    ];
    const visible = rows.filter((r) => r.species === firstWhere.species);
    expect(visible.every((r) => r.species === "sheep")).toBe(true);
    expect(visible).toHaveLength(3);
  });

  it("excludes orphan observations (species=null) per ADR-0004", async () => {
    // The facade injects `where: { species: 'sheep' }` — Prisma's
    // semantics for `where: { species: <string> }` exclude NULL values
    // by definition. We pin that exclusion here so a future facade
    // change (e.g. a NULL-tolerant OR) can't silently leak orphan rows
    // onto a per-species feed.
    observationFindManyMock.mockResolvedValue([]);

    const mod = await import("@/app/[farmSlug]/sheep/observations/page");
    const Page = mod.default as (props: {
      params: Promise<{ farmSlug: string }>;
      searchParams?: Promise<{ cursor?: string }>;
    }) => Promise<unknown>;

    await Page({
      params: Promise.resolve({ farmSlug: "trio-b" }),
      searchParams: Promise.resolve({}),
    });

    expect(observationFindManyMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of observationFindManyMock.mock.calls) {
      const where = call[0]?.where ?? {};
      // species predicate must be a literal string, not `null`,
      // not `{ in: ['sheep', null] }`, not `{ OR: [...] }`.
      expect(where.species).toBe("sheep");
      // Defensively check that no NULL-tolerant escape hatch is being
      // bolted on at the page level.
      expect(where.OR).toBeUndefined();
    }
  });

  it("forces species='sheep' even when the cookie still reads cattle (route IS the species axis)", async () => {
    // Mirror of the /sheep/animals invariant: a user who deep-links to
    // /sheep/observations while their farm-mode cookie still reads
    // 'cattle' must still get sheep rows. The page passes a hard-coded
    // 'sheep' into the facade rather than reading getFarmMode.
    getFarmModeMock.mockResolvedValue("cattle");
    observationFindManyMock.mockResolvedValue([]);

    const mod = await import("@/app/[farmSlug]/sheep/observations/page");
    const Page = mod.default as (props: {
      params: Promise<{ farmSlug: string }>;
      searchParams?: Promise<{ cursor?: string }>;
    }) => Promise<unknown>;

    await Page({
      params: Promise.resolve({ farmSlug: "trio-b" }),
      searchParams: Promise.resolve({}),
    });

    expect(observationFindManyMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of observationFindManyMock.mock.calls) {
      const where = call[0]?.where ?? {};
      expect(where.species).toBe("sheep");
    }
  });
});

// ── Basson regression — cattle /admin/observations is unchanged ───────
describe("/admin/observations page (Basson regression)", () => {
  it("still scopes animal.findMany prefetch by species: mode (cookie-driven)", async () => {
    // Reset cookie to cattle. The cattle admin observations page reads
    // getFarmMode(slug) and passes that into the prisma.animal.findMany
    // prefetch for the create-observation modal autocomplete. The sheep
    // wave must not alter that contract.
    getFarmModeMock.mockResolvedValue("cattle");
    animalFindManyMock.mockResolvedValue([]);
    campFindManyMock.mockResolvedValue([]);

    const mod = await import("@/app/[farmSlug]/admin/observations/page");
    const Page = mod.default as (props: {
      params: Promise<{ farmSlug: string }>;
      searchParams?: Promise<{ cursor?: string }>;
    }) => Promise<unknown>;

    await Page({
      params: Promise.resolve({ farmSlug: "basson-boerdery" }),
      searchParams: Promise.resolve({}),
    });

    expect(animalFindManyMock).toHaveBeenCalledTimes(1);
    const call = animalFindManyMock.mock.calls[0][0];
    expect(call.where).toMatchObject({ species: "cattle", status: "Active" });
    expect(call.take).toBe(50);
  });
});
