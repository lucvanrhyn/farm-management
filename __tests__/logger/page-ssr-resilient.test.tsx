/**
 * __tests__/logger/page-ssr-resilient.test.tsx
 *
 * Hotfix P0.2 — production triage 2026-05-03
 *
 * `/<farmSlug>/logger` was returning a deterministic SSR 500 (error digest
 * 3514534429) on prod for delta-livestock, making the entire logger
 * unreachable for field workers. Root cause: the page synchronously calls
 * `prisma.farmSettings.findFirst()` and any throw (cached-client schema
 * drift, libSQL token expiry) propagates straight to the Next.js error
 * boundary, blanking the page.
 *
 * The cure is to never let a `farmSettings` lookup take down the whole
 * logger surface. The page falls back to the brand default ("FarmTrack")
 * when the lookup fails, logs the error structured, and continues to
 * render the camp picker so field workers can still log observations.
 *
 * This pins the contract: even when prisma.findFirst throws, the page
 * resolves successfully with the fallback farmName.
 *
 * See:
 *   - memory/production-triage-2026-05-03.md (P0.2)
 *   - memory/silent-failure-pattern.md
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: { name: "Field Worker", email: "logger@example.com" },
  }),
}));

// Issue #234 — LoggerPage now reads the FarmMode cookie via
// `getFarmMode(slug)` to pre-fetch species-scoped camps. In the Vitest
// request-store-less environment, `cookies()` throws — stub the reader
// to return the cattle default so the page can resolve.
vi.mock("@/lib/server/get-farm-mode", () => ({
  getFarmMode: vi.fn().mockResolvedValue("cattle"),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    getSession: vi.fn().mockResolvedValue({
      user: { name: "Field Worker", email: "logger@example.com" },
    }),
  };
});

const findFirst = vi.fn();
const campFindMany = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/farm-prisma", () => ({
  getPrismaForFarm: vi.fn().mockResolvedValue({
    farmSettings: { findFirst },
    camp: { findMany: campFindMany },
  }),
}));

// Issue #234 — stub the species-scoped facade so the page's allowed-
// camp-IDs fetch resolves with an empty set in this hotfix-resilience
// suite. Behaviour under test here is the farmName-fallback path, not
// the camp filter (that's covered by
// __tests__/components/logger-camp-selector-mode-filter.test.tsx).
vi.mock("@/lib/server/species-scoped-prisma", () => ({
  scoped: () => ({
    camp: { findMany: campFindMany },
  }),
}));

// Logger page imports a couple of client components — they don't need
// network mocking because vitest renders them as React elements but
// doesn't actually mount client-only effects in this test environment.
vi.mock("@/components/logger/CampSelector", () => ({
  default: () => null,
}));
vi.mock("@/components/logger/LoggerStatusBar", () => ({
  LoggerStatusBar: () => null,
}));
vi.mock("@/components/logger/SignOutButton", () => ({
  SignOutButton: () => null,
}));
vi.mock("@/components/logger/TodaysTasks", () => ({
  TodaysTasks: () => null,
}));

describe("LoggerPage SSR resilience (hotfix P0.2)", () => {
  beforeEach(() => {
    findFirst.mockReset();
  });

  it("renders the page successfully when farmSettings resolves with a name", async () => {
    findFirst.mockResolvedValueOnce({ farmName: "Delta Livestock" });

    const Page = (await import("@/app/[farmSlug]/logger/page")).default;
    const tree = await Page({ params: Promise.resolve({ farmSlug: "delta-livestock" }) });

    expect(tree).toBeTruthy();
    // The element tree is React-renderable — JSON.stringify on a JSX tree
    // surfaces nested children. The farmName must appear somewhere.
    const serialized = JSON.stringify(tree);
    expect(serialized).toContain("Delta Livestock");
  });

  it("does NOT throw when prisma.farmSettings.findFirst rejects (the production crash)", async () => {
    findFirst.mockRejectedValueOnce(
      new Error("libsql_error: no such column: 'displayName'"),
    );

    const Page = (await import("@/app/[farmSlug]/logger/page")).default;

    // The crucial contract: this MUST resolve, not reject. Pre-hotfix,
    // the unhandled rejection bubbled to Next.js and rendered a 500.
    await expect(
      Page({ params: Promise.resolve({ farmSlug: "delta-livestock" }) }),
    ).resolves.toBeTruthy();
  });

  it("falls back to the FarmTrack brand name when farmSettings lookup throws", async () => {
    findFirst.mockRejectedValueOnce(new Error("Connection refused"));

    const Page = (await import("@/app/[farmSlug]/logger/page")).default;
    const tree = await Page({ params: Promise.resolve({ farmSlug: "delta-livestock" }) });

    const serialized = JSON.stringify(tree);
    expect(serialized).toContain("FarmTrack");
  });
});
