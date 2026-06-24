/**
 * @vitest-environment node
 *
 * lib/server/alerts/__tests__/weighing-stale.test.ts
 *
 * Regression lock for the cuid/tag join bug class on NO_WEIGHING_90D.
 *
 * Observation.animalId stores the animal TAG (Animal.animalId), not the cuid
 * Animal.id. The evaluator built its weighing lookup from Animal.id, so the
 * `where: { animalId: { in } }` matched zero rows and the per-animal Map read
 * (`.get(a.id)`) always missed — making EVERY active animal look un-weighed
 * and firing the alert herd-wide (a recently-weighed animal was
 * indistinguishable from one never weighed).
 *
 * Run end-to-end against a real in-memory libSQL tenant so the join axis is
 * exercised exactly as production does.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient, FarmSettings } from "@prisma/client";
import { makeTenantPrisma, daysAgo } from "@/__tests__/helpers/mem-tenant";
import { evaluate } from "@/lib/server/alerts/weighing-stale";

let prisma: PrismaClient;
let settings: FarmSettings;

async function seedAnimal(animalId: string): Promise<void> {
  await prisma.animal.create({
    data: {
      animalId,
      species: "cattle",
      category: "Cow",
      sex: "Female",
      status: "Active",
      currentCamp: "C1",
      dateAdded: "2024-01-01",
    },
  });
}

async function seedWeighing(animalTag: string, daysOld: number): Promise<void> {
  await prisma.observation.create({
    data: {
      type: "weighing",
      campId: "C1",
      animalId: animalTag, // the TAG — exactly how the logger/task paths write it
      details: "{}",
      observedAt: daysAgo(daysOld),
      species: "cattle",
    },
  });
}

beforeAll(async () => {
  prisma = await makeTenantPrisma();
  await prisma.farmSpeciesSettings.create({ data: { species: "cattle", enabled: true } });
  await prisma.camp.create({ data: { campId: "C1", campName: "Camp 1", species: "cattle" } });
  await prisma.farmSettings.create({ data: { id: "singleton", farmName: "Sim" } });
  settings = await prisma.farmSettings.findFirstOrThrow();

  await seedAnimal("A-FRESH");
  await seedAnimal("B-STALE");
  await seedAnimal("C-NEVER");
  await seedWeighing("A-FRESH", 5); // recently weighed → must NOT alert
  await seedWeighing("B-STALE", 200); // weighed 200d ago → must alert
  // C-NEVER has no weighing → must alert
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("NO_WEIGHING_90D — joins on the animal TAG, not the cuid", () => {
  it("does NOT flag an animal weighed within the last 90 days (no herd-wide false fire)", async () => {
    const candidates = await evaluate(prisma, settings, "test-farm");
    const tags = candidates.map((c) => c.payload?.animalId);
    expect(tags).not.toContain("A-FRESH");
  });

  it("flags the animal weighed 200 days ago and the animal never weighed", async () => {
    const candidates = await evaluate(prisma, settings, "test-farm");
    const tags = candidates.map((c) => c.payload?.animalId).sort();
    expect(tags).toEqual(["B-STALE", "C-NEVER"]);
  });

  it("reports the real days-since for a stale animal (proving the weighing was actually read)", async () => {
    const candidates = await evaluate(prisma, settings, "test-farm");
    const stale = candidates.find((c) => c.payload?.animalId === "B-STALE");
    expect(stale?.payload?.daysSince).toBeGreaterThanOrEqual(90);
    expect(stale?.message).toMatch(/not weighed in \d+ days/);
  });
});
