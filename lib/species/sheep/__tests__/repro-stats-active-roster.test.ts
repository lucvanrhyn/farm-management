/**
 * @vitest-environment node
 *
 * sheepModule.getReproStats — `upcomingBirths` is an ACTIVE-roster projection.
 *
 * Same lifecycle-leak class as the dashboard alerts (ADR-0010): a joining
 * observation persists after a ewe dies / is sold / is culled, so a list built
 * straight from joining observations (getUpcomingLambings) would surface a
 * dead/sold/culled ewe as "due to lamb". The /sheep/reproduction page
 * (UpcomingLambingsTable, OverdueLambingsTable) and the "Due <30 days" KPI both
 * render `upcomingBirths` directly, so this projection MUST intersect the active
 * roster — exactly like getAlerts already does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  activeAnimals: [] as unknown[],
  joining: [] as unknown[],
  lambing: [] as unknown[],
  camps: [] as unknown[],
}));

vi.mock("@/lib/server/species-scoped-prisma", () => ({
  scoped: (_prisma: unknown, _mode: string) => ({
    animal: {
      // scoped().animal injects status:Active — the active roster.
      findMany: vi.fn(() => Promise.resolve(mocks.activeAnimals)),
      count: vi.fn(() => Promise.resolve(0)),
    },
    observation: {
      findMany: vi.fn((args: { where?: { type?: string } }) => {
        const t = args?.where?.type;
        if (t === "joining") return Promise.resolve(mocks.joining);
        if (t === "lambing") return Promise.resolve(mocks.lambing);
        return Promise.resolve([]);
      }),
    },
    camp: {
      findMany: vi.fn(() => Promise.resolve(mocks.camps)),
    },
  }),
}));

import { sheepModule } from "@/lib/species/sheep";

const prisma = {} as unknown as PrismaClient;
const DAY = 24 * 60 * 60 * 1000;
// Joined ~120 days ago → expected lambing (join+150d) ~30 days out → in window.
const joinedSoon = () => new Date(Date.now() - 120 * DAY);
const joinObs = (animalId: string) => ({
  animalId,
  campId: "C1",
  observedAt: joinedSoon(),
  details: "{}",
});

describe("sheepModule.getReproStats — upcomingBirths active-roster intersection", () => {
  beforeEach(() => {
    mocks.activeAnimals = [];
    mocks.joining = [];
    mocks.lambing = [];
    mocks.camps = [];
  });

  it("includes an active ewe's upcoming lambing", async () => {
    mocks.activeAnimals = [{ animalId: "E1" }];
    mocks.joining = [joinObs("E1")];
    const stats = await sheepModule.getReproStats(prisma);
    expect(stats.upcomingBirths.map((b) => b.animalId)).toContain("E1");
  });

  it("does NOT surface a deceased/sold/culled ewe as due to lamb", async () => {
    mocks.activeAnimals = [{ animalId: "E1" }]; // active roster = [E1] only
    mocks.joining = [joinObs("E1"), joinObs("DEADEWE"), joinObs("CULLEWE")];
    const stats = await sheepModule.getReproStats(prisma);
    const ids = stats.upcomingBirths.map((b) => b.animalId);
    expect(ids).toContain("E1");
    expect(ids).not.toContain("DEADEWE");
    expect(ids).not.toContain("CULLEWE");
  });

  it("returns an empty projection when the only joined ewes are non-active", async () => {
    mocks.activeAnimals = []; // none active
    mocks.joining = [joinObs("DEADEWE")];
    const stats = await sheepModule.getReproStats(prisma);
    expect(stats.upcomingBirths).toHaveLength(0);
  });
});
