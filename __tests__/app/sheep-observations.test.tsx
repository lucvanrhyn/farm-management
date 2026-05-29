// @vitest-environment jsdom
/**
 * __tests__/app/sheep-observations.test.tsx
 *
 * Wave 5 (#231) — `/sheep/observations` tracer bullet, updated for #496.
 *
 * #496 migrated the visible sheep timeline OFF the SSR facade
 * (`scoped(prisma, "sheep").observation.findMany`) and ONTO the now
 * species-aware `/api/observations?species=sheep` endpoint that #491
 * introduced (the timeline fetches it client-side — see
 * `app/[farmSlug]/sheep/observations/__tests__/sheep-timeline-species-fetch.test.tsx`
 * for the request-wiring assertions). So this file no longer asserts a
 * page-level SSR observation read.
 *
 * Asserts:
 *  1. `/sheep/observations` issues NO server-side `observation.findMany`
 *     read — the species axis now flows through the client `?species=sheep`
 *     request, so there is no SSR cross-species leak surface on this page.
 *  2. The create-observation modal prefetches (`animal.findMany` /
 *     `camp.findMany`) still flow through the sheep-scoped facade, so a user
 *     who deep-links here with a stale `cattle` cookie still gets sheep
 *     autocomplete data (route IS the species axis, ADR-0003).
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

// ── #231 / #496 — sheep observations page ──────────────────────────────
describe("/sheep/observations page (#231 → #496)", () => {
  it("issues NO server-side observation.findMany (species axis moved to client ?species=sheep)", async () => {
    // #496 — the visible timeline now fetches `/api/observations?species=sheep`
    // client-side, so the page must NOT SSR-read observations at all. This
    // removes the SSR cross-species leak surface entirely (there is no
    // page-level observation query to mis-scope).
    observationFindManyMock.mockResolvedValue([]);

    const mod = await import("@/app/[farmSlug]/sheep/observations/page");
    const Page = mod.default as (props: {
      params: Promise<{ farmSlug: string }>;
    }) => Promise<unknown>;

    await Page({
      params: Promise.resolve({ farmSlug: "trio-b" }),
    });

    expect(observationFindManyMock).not.toHaveBeenCalled();
  });

  it("scopes the create-modal animal/camp prefetches to sheep even when the cookie reads cattle (route IS the species axis)", async () => {
    // A user who deep-links to /sheep/observations while their farm-mode
    // cookie still reads 'cattle' must still get sheep autocomplete data.
    // The page passes a hard-coded 'sheep' into the facade rather than
    // reading getFarmMode — mirror of the /sheep/animals invariant (ADR-0003).
    getFarmModeMock.mockResolvedValue("cattle");
    animalFindManyMock.mockResolvedValue([]);
    campFindManyMock.mockResolvedValue([]);

    const mod = await import("@/app/[farmSlug]/sheep/observations/page");
    const Page = mod.default as (props: {
      params: Promise<{ farmSlug: string }>;
    }) => Promise<unknown>;

    await Page({
      params: Promise.resolve({ farmSlug: "trio-b" }),
    });

    // Both prefetches flow through the sheep-scoped facade. The facade
    // injects `where: { species: 'sheep' }` on the animal prefetch;
    // crucially the cattle cookie does NOT leak in.
    expect(animalFindManyMock).toHaveBeenCalled();
    for (const call of animalFindManyMock.mock.calls) {
      const where = call[0]?.where ?? {};
      expect(where.species).not.toBe("cattle");
    }
    expect(campFindManyMock).toHaveBeenCalled();
    for (const call of campFindManyMock.mock.calls) {
      const where = call[0]?.where ?? {};
      expect(where.species).not.toBe("cattle");
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
