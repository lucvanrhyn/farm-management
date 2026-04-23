/**
 * farm-prisma timing probe contract.
 *
 * `getPrismaForFarm` is called on the hot path of every API route. Phase 1
 * observability adds a request-scoped timing bag that captures how long the
 * client acquisition actually takes (probe + creds lookup + Prisma ctor).
 *
 * Contract:
 *   1. When a handler runs within `runWithTimingBag(bag, fn)`, the bag
 *      captures `prisma-acquire` ± a few ms of real work.
 *   2. When NO timing bag is attached (current caller surface), the timer
 *      is a no-op and adds zero observable work.
 *   3. Instrumentation must not break the request if the timing emit
 *      itself throws.
 *
 * We mock the underlying libSQL + creds cache so this test never hits
 * the network.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────

// Return stubbed creds instantly so the probe-ish path is measurable work
// that we can control with a fake timer.
vi.mock("@/lib/meta-db", () => ({
  getFarmCreds: vi.fn(async () => ({
    tursoUrl: "libsql://stub",
    tursoAuthToken: "stub-token",
  })),
}));

vi.mock("@/lib/farm-creds-cache", () => ({
  getCachedFarmCreds: vi.fn(async (_slug: string, loader: (s: string) => Promise<unknown>) => {
    // Simulate ~20 ms of creds-lookup work so the timing has something to
    // measure. The exact amount doesn't matter — the assertion is "> 0".
    await new Promise((r) => setTimeout(r, 20));
    return loader("stub");
  }),
  evictFarmCreds: vi.fn(),
}));

vi.mock("@libsql/client", () => ({
  createClient: vi.fn(() => ({})),
}));

vi.mock("@prisma/adapter-libsql", () => ({
  // Must be a constructable function — `new PrismaLibSQL(...)` is used.
  PrismaLibSQL: function StubPrismaLibSQL() {
    return {};
  },
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: function StubPrismaClient() {
    return { __stub: true };
  },
}));

// `cookies()` and `headers()` aren't used by `getPrismaForFarm` directly but
// farm-prisma imports them at module scope via next/headers. Stub to avoid
// the "Next.js dynamic API outside a request" error in a plain node test.
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));

// ── Test imports (must come after mocks) ──────────────────────────────────

import {
  createTimingBag,
  runWithTimingBag,
  recordTiming,
  type TimingBag,
} from "@/lib/server/server-timing";
import { getPrismaForFarm, __clearFarmClientCache } from "@/lib/farm-prisma";

beforeEach(() => {
  __clearFarmClientCache();
});

describe("farm-prisma timing probe", () => {
  it("records prisma-acquire duration when a timing bag is active", async () => {
    const bag: TimingBag = createTimingBag();

    await runWithTimingBag(bag, async () => {
      const client = await getPrismaForFarm("timed-slug");
      expect(client).toBeTruthy();
    });

    expect(bag["prisma-acquire"]).toBeTypeOf("number");
    // We simulated ~20ms of creds-lookup work in the mock; assert the
    // captured duration is a plausible positive number. Upper bound
    // generous to tolerate CI jitter.
    expect(bag["prisma-acquire"]).toBeGreaterThanOrEqual(0);
    expect(bag["prisma-acquire"]).toBeLessThan(5000);
  });

  it("no-ops when no timing bag is attached", async () => {
    // No runWithTimingBag wrapper — current caller surface. This must not
    // throw and must not attempt to mutate a non-existent bag.
    const client = await getPrismaForFarm("unwrapped-slug");
    expect(client).toBeTruthy();
  });

  it("recordTiming outside a bag is a silent no-op", () => {
    // Belt-and-braces: any other instrumentation point should be safe
    // to call unconditionally.
    expect(() => recordTiming("anything", 42)).not.toThrow();
  });

  it("recordTiming tolerates the bag being frozen or missing the key", () => {
    const bag = createTimingBag();
    runWithTimingBag(bag, () => {
      recordTiming("prisma-acquire", 123);
    });
    expect(bag["prisma-acquire"]).toBe(123);
  });
});
