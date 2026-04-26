// lib/server/breeding/snapshot.ts
// Breeding snapshot — herd-level summary of breeding sires in service,
// pregnant/open dams, expected births this month, and a parturition calendar.
//
// Phase F: species-aware. The optional `species` argument routes through
// `lib/species/breeding-constants.ts` to pick gestation period, sire
// category, and dam categories. Default ("cattle") preserves the historical
// signature — old call sites work unchanged.

import type { PrismaClient } from "@prisma/client";
import type { BreedingSnapshot } from "./types";
import { addDays, daysFromNow, parseDetails } from "./utils";
import { getBreedingConstants } from "@/lib/species/breeding-constants";
import type { SpeciesId } from "@/lib/species/types";

export async function getBreedingSnapshot(
  prisma: PrismaClient,
  farmSlug: string,
  species: SpeciesId = "cattle",
): Promise<BreedingSnapshot> {
  void farmSlug;
  const constants = getBreedingConstants(species);
  const femaleCategorySet = new Set(constants.femaleCategories);

  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
  const oneYearAgo = new Date(Date.now() - 365 * 86_400_000);
  const sixtyDaysFromNow = new Date(Date.now() + 60 * 86_400_000);
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 86_400_000);

  const [allAnimals, recentPregnancyScans, recentInseminations] = await Promise.all([
    prisma.animal.findMany({
      where: { status: "Active", species },
      select: {
        id: true,
        animalId: true,
        sex: true,
        category: true,
        status: true,
        motherId: true,
        fatherId: true,
      },
    }),
    prisma.observation.findMany({
      where: {
        type: "pregnancy_scan",
        species,
        observedAt: { gte: oneYearAgo },
        animalId: { not: null },
      },
      orderBy: { observedAt: "desc" },
      select: { animalId: true, details: true, observedAt: true },
    }),
    prisma.observation.findMany({
      where: {
        type: "insemination",
        species,
        observedAt: { gte: ninetyDaysAgo },
        animalId: { not: null },
      },
      orderBy: { observedAt: "desc" },
      select: { animalId: true, observedAt: true },
    }),
  ]);

  const bulls = allAnimals.filter((a) => a.category === constants.sireCategory);
  const bullsInService = bulls.length;

  const latestScanByAnimal = new Map<string, { result: string; observedAt: Date }>();
  for (const obs of recentPregnancyScans) {
    if (!obs.animalId) continue;
    if (!latestScanByAnimal.has(obs.animalId)) {
      const d = parseDetails(obs.details);
      latestScanByAnimal.set(obs.animalId, {
        result: d.result ?? "uncertain",
        observedAt: obs.observedAt,
      });
    }
  }

  const pregnantAnimalIds = new Set<string>();
  for (const [id, scan] of latestScanByAnimal.entries()) {
    if (scan.result === "pregnant") pregnantAnimalIds.add(id);
  }
  const pregnantCows = pregnantAnimalIds.size;

  const femaleCows = allAnimals.filter(
    (a) => a.sex === "Female" && femaleCategorySet.has(a.category),
  );
  const openCows = femaleCows.filter((a) => !pregnantAnimalIds.has(a.id)).length;

  const calendarEntries: Array<{ animalId: string; animalTag: string; expectedDate: string }> = [];
  const animalTagMap = new Map(allAnimals.map((a) => [a.id, a.animalId]));

  const latestInsemByAnimal = new Map<string, Date>();
  for (const obs of recentInseminations) {
    if (!obs.animalId) continue;
    if (!latestInsemByAnimal.has(obs.animalId)) {
      latestInsemByAnimal.set(obs.animalId, obs.observedAt);
    }
  }

  const candidateIds = new Set<string>([
    ...Array.from(pregnantAnimalIds),
    ...Array.from(latestInsemByAnimal.keys()),
  ]);

  for (const animalId of candidateIds) {
    const scan = latestScanByAnimal.get(animalId);
    const insem = latestInsemByAnimal.get(animalId);
    const baseDate = scan?.observedAt ?? insem;
    if (!baseDate) continue;

    const expectedDate = addDays(baseDate, constants.gestationDays);
    if (expectedDate > sixtyDaysFromNow) continue;
    if (daysFromNow(expectedDate) < -7) continue;

    const tag = animalTagMap.get(animalId) ?? animalId;
    calendarEntries.push({
      animalId,
      animalTag: tag,
      expectedDate: expectedDate.toISOString().slice(0, 10),
    });
  }

  calendarEntries.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));

  const expectedCalvingsThisMonth = calendarEntries.filter(
    (e) => new Date(e.expectedDate) <= thirtyDaysFromNow && new Date(e.expectedDate) >= new Date(),
  ).length;

  return {
    bullsInService,
    pregnantCows,
    openCows,
    expectedCalvingsThisMonth,
    calendarEntries,
  };
}
