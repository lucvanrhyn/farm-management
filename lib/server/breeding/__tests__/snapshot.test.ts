/**
 * @vitest-environment node
 *
 * lib/server/breeding/__tests__/snapshot.test.ts
 *
 * Regression lock for the cuid/tag join bug class on getBreedingSnapshot.
 *
 * `pregnantAnimalIds` is a Set of Observation.animalId values (TAGs), but the
 * open-dam count tested membership with Animal.id (cuid) — so NO cow was ever
 * recognised as pregnant and the "open dams" KPI was inflated to the entire
 * female herd. (The display tag map had the mirror-image mismatch; it only
 * produced the right tag by accident via a fallback.)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { makeTenantPrisma, daysAgo } from "@/__tests__/helpers/mem-tenant";
import { getBreedingSnapshot } from "@/lib/server/breeding/snapshot";

let prisma: PrismaClient;

async function seedAnimal(animalId: string, category: string, sex: string): Promise<void> {
  await prisma.animal.create({
    data: {
      animalId,
      species: "cattle",
      category,
      sex,
      status: "Active",
      currentCamp: "C1",
      dateAdded: "2022-01-01",
    },
  });
}

beforeAll(async () => {
  prisma = await makeTenantPrisma();
  await prisma.farmSpeciesSettings.create({ data: { species: "cattle", enabled: true } });
  await prisma.camp.create({ data: { campId: "C1", campName: "Camp 1", species: "cattle" } });

  await seedAnimal("BULL-1", "Bull", "Male");
  await seedAnimal("COW-PREG", "Cow", "Female");
  await seedAnimal("COW-OPEN", "Cow", "Female");

  // COW-PREG: latest scan pregnant, ~230d ago → expected calving ~55d out (in calendar).
  await prisma.observation.create({
    data: {
      type: "pregnancy_scan",
      campId: "C1",
      animalId: "COW-PREG", // the TAG
      details: JSON.stringify({ result: "pregnant" }),
      observedAt: daysAgo(230),
      species: "cattle",
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getBreedingSnapshot — joins on the animal TAG, not the cuid", () => {
  it("counts open dams correctly (pregnant cow excluded, not the whole herd)", async () => {
    const snap = await getBreedingSnapshot(prisma, "test-farm", "cattle");
    expect(snap.pregnantCows).toBe(1);
    expect(snap.openCows).toBe(1); // only COW-OPEN — NOT inflated to 2
    expect(snap.bullsInService).toBe(1);
  });

  it("labels the parturition-calendar entry with the animal tag", async () => {
    const snap = await getBreedingSnapshot(prisma, "test-farm", "cattle");
    const entry = snap.calendarEntries.find((e) => e.animalTag === "COW-PREG");
    expect(entry).toBeDefined();
    expect(entry?.animalId).toBe("COW-PREG");
  });
});
