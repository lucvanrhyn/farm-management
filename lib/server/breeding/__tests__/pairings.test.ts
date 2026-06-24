/**
 * @vitest-environment node
 *
 * lib/server/breeding/__tests__/pairings.test.ts
 *
 * Regression lock for the cuid/tag join bug class on suggestPairings.
 *
 * Two failures, both rooted in cuid-vs-tag:
 *  1. The "open cow" gate read the latest-scan Map (keyed by the tag) with the
 *     cuid, so it ALWAYS missed → every pregnant cow leaked into the breeding
 *     pool (pregnant dams suggested for re-service).
 *  2. The trait-observation pipeline built its id filter + in-memory builders
 *     from the cuid, so no trait observation ever matched → every pairing came
 *     back with a blank trait profile (fertility/temperament/etc. all null).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { makeTenantPrisma, daysAgo } from "@/__tests__/helpers/mem-tenant";
import { suggestPairings } from "@/lib/server/breeding/pairings";

let prisma: PrismaClient;

async function seedAnimal(
  animalId: string,
  category: string,
  sex: string,
  extra: { fatherId?: string } = {},
): Promise<void> {
  await prisma.animal.create({
    data: {
      animalId,
      species: "cattle",
      category,
      sex,
      status: "Active",
      currentCamp: "C1",
      dateAdded: "2022-01-01",
      fatherId: extra.fatherId ?? null,
    },
  });
}

async function seedObs(
  animalTag: string,
  type: string,
  details: Record<string, unknown>,
  daysOld = 30,
): Promise<void> {
  await prisma.observation.create({
    data: {
      type,
      campId: "C1",
      animalId: animalTag, // the TAG
      details: JSON.stringify(details),
      observedAt: daysAgo(daysOld),
      species: "cattle",
    },
  });
}

beforeAll(async () => {
  prisma = await makeTenantPrisma();
  await prisma.farmSpeciesSettings.create({ data: { species: "cattle", enabled: true } });
  await prisma.camp.create({ data: { campId: "C1", campName: "Camp 1", species: "cattle" } });

  // fatherId on the bull provides the pedigree seed the gate requires.
  await seedAnimal("BULL-1", "Bull", "Male", { fatherId: "ANCESTOR-X" });
  await seedAnimal("COW-OPEN", "Cow", "Female");
  await seedAnimal("COW-PREG", "Cow", "Female");

  // COW-PREG is pregnant → must be EXCLUDED from the open pool.
  await seedObs("COW-PREG", "pregnancy_scan", { result: "pregnant" });
  // Trait signal that must flow into the suggestion via the tag join.
  await seedObs("BULL-1", "scrotal_circumference", { measurement_cm: "36" });
  await seedObs("COW-OPEN", "temperament_score", { score: "1" });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("suggestPairings — joins on the animal TAG, not the cuid", () => {
  it("excludes pregnant cows from the breeding pool", async () => {
    const result = await suggestPairings(prisma, "test-farm", "cattle");
    const cowTags = result.pairings.map((p) => p.cowTag);
    expect(cowTags).not.toContain("COW-PREG");
    expect(cowTags).toContain("COW-OPEN");
  });

  it("populates the trait profile from tag-keyed observations", async () => {
    const result = await suggestPairings(prisma, "test-farm", "cattle");
    const pairing = result.pairings.find(
      (p) => p.bullTag === "BULL-1" && p.cowTag === "COW-OPEN",
    );
    expect(pairing).toBeDefined();
    // scrotalCirc 36cm → fertility 85 (bull trait pipeline read the tag obs)
    expect(pairing?.traitBreakdown?.fertility).toBe(85);
    // COW-OPEN temperament 1 → temperament score present (cow builder read the tag obs)
    expect(pairing?.traitBreakdown?.temperament).not.toBeNull();
  });
});
