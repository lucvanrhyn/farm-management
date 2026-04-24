// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

// Build a stub libSQL client factory so createFarmClient succeeds without
// touching real Turso. The farm-prisma module only calls `createClient` to
// hand it to PrismaLibSQL; the in-memory URL is never actually dialed.
vi.mock("@libsql/client", () => ({
  createClient: vi.fn(() => ({ close: vi.fn() })),
}));
vi.mock("@prisma/adapter-libsql", () => ({
  PrismaLibSQL: vi.fn(),
}));
vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(function (this: Record<string, unknown>) {
    this._isMock = true;
  }),
}));

// Control the credential cache so getPrismaForFarm sees the URL we want to
// tag with. The stubbed loader returns the Frankfurt URL we're asserting on.
const fakeCreds: Record<string, { tursoUrl: string; tursoAuthToken: string; tier: string }> = {
  frankfurt: {
    tursoUrl: "libsql://trio-b-frankfurt.aws-eu-central-1.turso.io",
    tursoAuthToken: "t1",
    tier: "basic",
  },
  legacy: {
    tursoUrl: "libsql://oldfarm.aws-ap-northeast-1.turso.io",
    tursoAuthToken: "t2",
    tier: "basic",
  },
};
vi.mock("@/lib/meta-db", () => ({
  getFarmCreds: vi.fn(async (slug: string) => fakeCreds[slug] ?? null),
}));
vi.mock("@/lib/farm-creds-cache", () => ({
  // Passthrough: always invoke the loader; no caching needed for this test.
  getCachedFarmCreds: vi.fn(
    async (slug: string, loader: (s: string) => Promise<unknown>) => loader(slug),
  ),
  evictFarmCreds: vi.fn(),
}));

import {
  createTimingBag,
  emitServerTiming,
  runWithTimingBag,
} from "@/lib/server/server-timing";
import {
  getPrismaForFarm,
  __clearFarmClientCache,
} from "@/lib/farm-prisma";

beforeEach(() => {
  __clearFarmClientCache();
});

describe("farm-prisma region tagging", () => {
  it("records `db-region-fra` when a Frankfurt farm client is acquired", async () => {
    const bag = createTimingBag();
    await runWithTimingBag(bag, async () => {
      const prisma = await getPrismaForFarm("frankfurt");
      expect(prisma).toBeTruthy();
    });

    const header = emitServerTiming(bag);
    expect(header).toContain("db-region-fra");
  });

  it("records `db-region-nrt` when a legacy Tokyo farm client is acquired — exposes cutover drift", async () => {
    const bag = createTimingBag();
    await runWithTimingBag(bag, async () => {
      await getPrismaForFarm("legacy");
    });

    const header = emitServerTiming(bag);
    expect(header).toContain("db-region-nrt");
  });

  it("does not crash when no timing bag is active", async () => {
    await expect(getPrismaForFarm("frankfurt")).resolves.toBeTruthy();
  });
});
