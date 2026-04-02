// lib/server/breeding-analytics.ts
import type { PrismaClient } from "@prisma/client";

const GESTATION_DAYS = 285;

export interface BreedingSnapshot {
  bullsInService: number;
  pregnantCows: number;
  openCows: number;
  expectedCalvingsThisMonth: number;
  calendarEntries: Array<{
    animalId: string;
    animalTag: string;
    expectedDate: string;
  }>;
}

export interface InbreedingRisk {
  animalId: string;
  tag: string;
  riskType: "parent_offspring" | "sibling" | "shared_grandparent";
  relatedAnimalId: string;
  relatedTag: string;
}

export interface PairingSuggestion {
  bullId: string;
  bullTag: string;
  cowId: string;
  cowTag: string;
  reason: string;
}

interface AnimalRow {
  id: string;
  animalId: string;
  sex: string;
  category: string;
  status: string;
  motherId: string | null;
  fatherId: string | null;
}

function parseDetails(raw: string): Record<string, string> {
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function daysFromNow(date: Date): number {
  return Math.round((date.getTime() - Date.now()) / 86_400_000);
}

export async function getBreedingSnapshot(
  prisma: PrismaClient,
  farmSlug: string,
): Promise<BreedingSnapshot> {
  // Suppress unused variable — farmSlug reserved for future multi-tenant filtering
  void farmSlug;

  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
  const oneYearAgo = new Date(Date.now() - 365 * 86_400_000);
  const sixtyDaysFromNow = new Date(Date.now() + 60 * 86_400_000);
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 86_400_000);

  const [allAnimals, recentPregnancyScans, recentInseminations] = await Promise.all([
    prisma.animal.findMany({
      where: { status: "Active" },
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
        observedAt: { gte: oneYearAgo },
        animalId: { not: null },
      },
      orderBy: { observedAt: "desc" },
      select: { animalId: true, details: true, observedAt: true },
    }),
    prisma.observation.findMany({
      where: {
        type: "insemination",
        observedAt: { gte: ninetyDaysAgo },
        animalId: { not: null },
      },
      orderBy: { observedAt: "desc" },
      select: { animalId: true, observedAt: true },
    }),
  ]);

  // Bulls: only animals with category "Bull" (excludes male calves/weaners)
  const bulls = allAnimals.filter((a) => a.category === "Bull");
  const bullsInService = bulls.length;

  // Latest scan per animal
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

  // Pregnant cows: latest scan result = "pregnant"
  const pregnantAnimalIds = new Set<string>();
  for (const [id, scan] of latestScanByAnimal.entries()) {
    if (scan.result === "pregnant") pregnantAnimalIds.add(id);
  }
  const pregnantCows = pregnantAnimalIds.size;

  // Open cows: female animals not currently pregnant
  const femaleCows = allAnimals.filter(
    (a) => a.sex === "Female" && (a.category === "Cow" || a.category === "Heifer"),
  );
  const openCows = femaleCows.filter((a) => !pregnantAnimalIds.has(a.id)).length;

  // Build calving timeline from pregnant scans + inseminations
  const calendarEntries: Array<{ animalId: string; animalTag: string; expectedDate: string }> = [];
  const animalTagMap = new Map(allAnimals.map((a) => [a.id, a.animalId]));

  // From inseminations: estimate expected calving
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

    const expectedDate = addDays(baseDate, GESTATION_DAYS);
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

export function detectInbreedingRisk(animals: AnimalRow[]): InbreedingRisk[] {
  const risks: InbreedingRisk[] = [];
  const animalMap = new Map(animals.map((a) => [a.id, a]));

  for (let i = 0; i < animals.length; i++) {
    const a = animals[i];
    for (let j = i + 1; j < animals.length; j++) {
      const b = animals[j];

      // Parent-offspring
      if (
        (a.motherId && a.motherId === b.id) ||
        (a.fatherId && a.fatherId === b.id) ||
        (b.motherId && b.motherId === a.id) ||
        (b.fatherId && b.fatherId === a.id)
      ) {
        risks.push({
          animalId: a.id,
          tag: a.animalId,
          riskType: "parent_offspring",
          relatedAnimalId: b.id,
          relatedTag: b.animalId,
        });
        continue;
      }

      // Full siblings: same mother AND same father (both non-null)
      if (
        a.motherId &&
        a.fatherId &&
        a.motherId === b.motherId &&
        a.fatherId === b.fatherId
      ) {
        risks.push({
          animalId: a.id,
          tag: a.animalId,
          riskType: "sibling",
          relatedAnimalId: b.id,
          relatedTag: b.animalId,
        });
        continue;
      }

      // Shared grandparent: check if a's parents share lineage with b's parents
      const aParents = [a.motherId, a.fatherId].filter(Boolean) as string[];
      const bParents = [b.motherId, b.fatherId].filter(Boolean) as string[];

      const aGrandparents = new Set<string>();
      for (const pid of aParents) {
        const p = animalMap.get(pid);
        if (p?.motherId) aGrandparents.add(p.motherId);
        if (p?.fatherId) aGrandparents.add(p.fatherId);
      }

      for (const pid of bParents) {
        const p = animalMap.get(pid);
        const bGrandparents = [p?.motherId, p?.fatherId].filter(Boolean) as string[];
        for (const gp of bGrandparents) {
          if (aGrandparents.has(gp)) {
            risks.push({
              animalId: a.id,
              tag: a.animalId,
              riskType: "shared_grandparent",
              relatedAnimalId: b.id,
              relatedTag: b.animalId,
            });
            break;
          }
        }
      }
    }
  }

  return risks;
}

export async function suggestPairings(
  prisma: PrismaClient,
  farmSlug: string,
): Promise<PairingSuggestion[]> {
  void farmSlug;

  const oneYearAgo = new Date(Date.now() - 365 * 86_400_000);

  const [allAnimals, recentScans] = await Promise.all([
    prisma.animal.findMany({
      where: { status: "Active" },
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
        observedAt: { gte: oneYearAgo },
        animalId: { not: null },
      },
      orderBy: { observedAt: "desc" },
      select: { animalId: true, details: true },
    }),
  ]);

  // Latest scan per animal
  const latestScanResult = new Map<string, string>();
  for (const obs of recentScans) {
    if (!obs.animalId) continue;
    if (!latestScanResult.has(obs.animalId)) {
      const d = parseDetails(obs.details);
      latestScanResult.set(obs.animalId, d.result ?? "uncertain");
    }
  }

  const bulls = allAnimals.filter((a) => a.category === "Bull");
  const openCows = allAnimals.filter((a) => {
    if (a.sex !== "Female") return false;
    if (a.category !== "Cow" && a.category !== "Heifer") return false;
    const scan = latestScanResult.get(a.id);
    return scan !== "pregnant";
  });

  const risks = detectInbreedingRisk(allAnimals);
  const riskPairs = new Set(
    risks.map((r) => `${r.animalId}:${r.relatedAnimalId}`),
  );

  const suggestions: PairingSuggestion[] = [];

  for (const bull of bulls) {
    for (const cow of openCows) {
      const pairKey = `${bull.id}:${cow.id}`;
      const reversePairKey = `${cow.id}:${bull.id}`;

      if (riskPairs.has(pairKey) || riskPairs.has(reversePairKey)) continue;

      const reason =
        cow.category === "Heifer"
          ? "Open heifer — no inbreeding conflict detected"
          : "Open cow — no inbreeding conflict detected";

      suggestions.push({
        bullId: bull.id,
        bullTag: bull.animalId,
        cowId: cow.id,
        cowTag: cow.animalId,
        reason,
      });
    }
  }

  return suggestions;
}
