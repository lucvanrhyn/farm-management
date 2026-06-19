/**
 * @vitest-environment node
 *
 * reproduction-analytics getReproStats — `upcomingCalvings` is an ACTIVE-roster
 * projection.
 *
 * Same lifecycle-leak class as the dashboard alerts (ADR-0010): an insemination
 * / pregnancy-scan observation persists after a cow dies / is sold / is culled.
 * `upcomingCalvings` is built straight from those observations, so without an
 * active-roster intersection a dead/sold/culled cow is surfaced as "due to
 * calve" on /admin/reproduction (UpcomingCalvingsTable) and leaks into the
 * calving / reproduction CSV exports. It MUST intersect the active roster
 * (scoped().animal injects status:Active).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  activeAnimals: [] as unknown[],
  reproObs: [] as unknown[],
  calving: [] as unknown[],
  camps: [] as unknown[],
}));

vi.mock("@/lib/server/species-scoped-prisma", () => ({
  scoped: (_prisma: unknown, _mode: string) => ({
    animal: {
      // scoped().animal injects status:Active — the active roster.
      findMany: vi.fn(() => Promise.resolve(mocks.activeAnimals)),
    },
    observation: {
      findMany: vi.fn((args: { where?: { type?: unknown } }) => {
        const t = args?.where?.type;
        if (t === "calving") return Promise.resolve(mocks.calving);
        // the { type: { in: [heat,insem,scan] } } query
        return Promise.resolve(mocks.reproObs);
      }),
    },
    camp: {
      findMany: vi.fn(() => Promise.resolve(mocks.camps)),
    },
  }),
}));

import { getReproStats } from "@/lib/server/reproduction-analytics";

const prisma = {} as unknown as PrismaClient;
const DAY = 24 * 60 * 60 * 1000;
// Inseminated ~280 days ago → expected calving (insem + 285d) ~5 days out → in window.
const insemSoon = () => new Date(Date.now() - 280 * DAY);
const insemObs = (animalId: string) => ({
  id: `obs-${animalId}`,
  type: "insemination",
  animalId,
  campId: "C1",
  observedAt: insemSoon(),
  loggedBy: "t",
  details: "{}",
});

describe("reproduction-analytics getReproStats — upcomingCalvings active-roster intersection", () => {
  beforeEach(() => {
    mocks.activeAnimals = [];
    mocks.reproObs = [];
    mocks.calving = [];
    mocks.camps = [];
  });

  it("includes an active cow's upcoming calving", async () => {
    mocks.activeAnimals = [{ animalId: "C1A" }];
    mocks.reproObs = [insemObs("C1A")];
    const stats = await getReproStats(prisma, { species: "cattle" });
    expect(stats.upcomingCalvings.map((c) => c.animalId)).toContain("C1A");
  });

  it("does NOT surface a deceased/sold/culled cow as due to calve", async () => {
    mocks.activeAnimals = [{ animalId: "C1A" }]; // active roster = [C1A] only
    mocks.reproObs = [insemObs("C1A"), insemObs("DEADCOW"), insemObs("SOLDCOW")];
    const stats = await getReproStats(prisma, { species: "cattle" });
    const ids = stats.upcomingCalvings.map((c) => c.animalId);
    expect(ids).toContain("C1A");
    expect(ids).not.toContain("DEADCOW");
    expect(ids).not.toContain("SOLDCOW");
  });

  it("calvingsDue30d counts the active cow only", async () => {
    mocks.activeAnimals = [{ animalId: "C1A" }];
    mocks.reproObs = [insemObs("C1A"), insemObs("DEADCOW")];
    const stats = await getReproStats(prisma, { species: "cattle" });
    expect(stats.calvingsDue30d).toBe(1);
  });
});
