/**
 * @vitest-environment node
 *
 * lib/server/alerts/__tests__/lambing-due.test.ts
 *
 * Regression lock for the cuid/tag join bug class on LAMBING_DUE_7D.
 *
 * The evaluator filtered observations and read its pregnant/mating Maps by
 * Animal.id (cuid). Observation.animalId is the TAG, so the filter matched
 * nothing and `pregnantByAnimal.get(ewe.id)` always missed — the alert was
 * silently DEAD (no lambing ever surfaced).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient, FarmSettings } from "@prisma/client";
import { makeTenantPrisma, daysAgo } from "@/__tests__/helpers/mem-tenant";
import { evaluate } from "@/lib/server/alerts/lambing-due";

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

async function seedObs(
  animalTag: string,
  type: string,
  daysOld: number,
  details: Record<string, unknown> = {},
): Promise<void> {
  await prisma.observation.create({
    data: {
      type,
      campId: "S1",
      animalId: animalTag, // the TAG
      details: JSON.stringify(details),
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

  await seedEwe("EWE-LAMB"); // pregnant, mated 144d ago → due in ~3d (inside 7d window)
  await seedEwe("EWE-EMPTY"); // scanned empty, mated 144d ago → must NOT fire
  await seedEwe("EWE-FAR"); // pregnant but mated 10d ago → due far out → must NOT fire

  await seedObs("EWE-LAMB", "pregnancy_scan", 5, { result: "pregnant" });
  await seedObs("EWE-LAMB", "insemination", 144);
  await seedObs("EWE-EMPTY", "pregnancy_scan", 5, { result: "empty" });
  await seedObs("EWE-EMPTY", "insemination", 144);
  await seedObs("EWE-FAR", "pregnancy_scan", 5, { result: "pregnant" });
  await seedObs("EWE-FAR", "insemination", 10);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("LAMBING_DUE_7D — joins on the ewe TAG, not the cuid", () => {
  it("fires for the pregnant ewe due within 7 days (was silently dead)", async () => {
    const candidates = await evaluate(prisma, settings, "test-farm");
    expect(candidates.map((c) => c.payload?.animalId)).toEqual(["EWE-LAMB"]);
  });

  it("does not fire for an empty-scan ewe or a pregnant ewe still far from lambing", async () => {
    const candidates = await evaluate(prisma, settings, "test-farm");
    const tags = candidates.map((c) => c.payload?.animalId);
    expect(tags).not.toContain("EWE-EMPTY");
    expect(tags).not.toContain("EWE-FAR");
  });
});
