/**
 * @vitest-environment node
 *
 * lib/server/alerts/__tests__/shearing-crutching.test.ts
 *
 * Regression lock for the cuid/tag join bug class on SHEARING_DUE / CRUTCHING_DUE.
 *
 * The evaluator built its observation filter + per-ewe Map reads from
 * Animal.id (cuid). Because Observation.animalId stores the TAG, the
 * `where: { animalId: { in } }` matched nothing and `Map.get(ewe.id)` always
 * missed: SHEARING_DUE fired for EVERY ewe (looked never-shorn) and
 * CRUTCHING_DUE could never fire (no mating event was ever found).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient, FarmSettings } from "@prisma/client";
import { makeTenantPrisma, daysAgo } from "@/__tests__/helpers/mem-tenant";
import { evaluate } from "@/lib/server/alerts/shearing-crutching";

let prisma: PrismaClient;
let settings: FarmSettings;

async function seedEwe(animalId: string): Promise<void> {
  await prisma.animal.create({
    data: {
      animalId,
      species: "sheep",
      category: "Ewe",
      sex: "Female",
      status: "Active",
      currentCamp: "S1",
      dateAdded: "2023-01-01",
    },
  });
}

async function seedObs(animalTag: string, type: string, daysOld: number): Promise<void> {
  await prisma.observation.create({
    data: {
      type,
      campId: "S1",
      animalId: animalTag, // the TAG
      details: "{}",
      observedAt: daysAgo(daysOld),
      species: "sheep",
    },
  });
}

beforeAll(async () => {
  prisma = await makeTenantPrisma();
  await prisma.farmSpeciesSettings.create({ data: { species: "sheep", enabled: true } });
  await prisma.camp.create({ data: { campId: "S1", campName: "Sheep Camp", species: "sheep" } });
  await prisma.farmSettings.create({ data: { id: "singleton", farmName: "Sim" } });
  settings = await prisma.farmSettings.findFirstOrThrow();

  await seedEwe("EWE-FRESH");
  await seedEwe("EWE-STALE");
  await seedEwe("EWE-NONE");
  await seedEwe("EWE-CRUTCH");

  await seedObs("EWE-FRESH", "shearing", 10); // shorn recently → NOT shearing-due
  await seedObs("EWE-STALE", "shearing", 300); // shorn 300d ago (> 240) → shearing-due
  // EWE-NONE: never shorn → shearing-due
  // EWE-CRUTCH: mated 132d ago → lambing in ~15d → inside the 30d crutch window
  await seedObs("EWE-CRUTCH", "insemination", 132);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("SHEARING_DUE / CRUTCHING_DUE — join on the ewe TAG, not the cuid", () => {
  it("does NOT flag a ewe shorn within the interval (no herd-wide false fire)", async () => {
    const candidates = await evaluate(prisma, settings, "test-farm");
    const shearTags = candidates
      .filter((c) => c.type === "SHEARING_DUE")
      .map((c) => c.payload?.animalId);
    expect(shearTags).not.toContain("EWE-FRESH");
  });

  it("flags exactly the ewes overdue or never shorn", async () => {
    const candidates = await evaluate(prisma, settings, "test-farm");
    const shearTags = candidates
      .filter((c) => c.type === "SHEARING_DUE")
      .map((c) => c.payload?.animalId)
      .sort();
    expect(shearTags).toEqual(["EWE-CRUTCH", "EWE-NONE", "EWE-STALE"]);
  });

  it("fires CRUTCHING_DUE for the ewe inside the pre-lambing window (was dead)", async () => {
    const candidates = await evaluate(prisma, settings, "test-farm");
    const crutch = candidates.filter((c) => c.type === "CRUTCHING_DUE");
    expect(crutch.map((c) => c.payload?.animalId)).toEqual(["EWE-CRUTCH"]);
    expect(crutch[0]?.payload?.daysToLambing).toBeGreaterThanOrEqual(0);
  });
});
