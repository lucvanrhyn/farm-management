// lib/server/breeding-analytics.ts
import type { PrismaClient } from "@prisma/client";

const GESTATION_DAYS = 285;
const MAX_PAIRINGS = 30;
const COI_HARD_LIMIT = 0.0625; // 6.25% — skip entirely
const COI_SOFT_LIMIT = 0.03125; // 3.125% — start penalizing
const HIGH_BIRTH_WEIGHT_KG = 38;
const MAX_PEDIGREE_DEPTH = 3;

// ============================================================
// Interfaces
// ============================================================

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

export interface TraitProfile {
  birthWeight: number | null;
  calvingDifficultyAvg: number | null;
  bcsLatest: number | null;
  temperamentLatest: number | null;
  scrotalCirc: number | null;
  offspringCount: number;
}

export interface PairingSuggestion {
  bullId: string;
  bullTag: string;
  cowId: string;
  cowTag: string;
  score: number;
  coi: number;
  reason: string;
  riskFlags: string[];
  traitBreakdown?: {
    growth: number | null;
    fertility: number | null;
    calvingEase: number | null;
    temperament: number | null;
  };
}

/**
 * Result envelope for suggestPairings.
 *
 * Why not just return PairingSuggestion[]?
 *
 * When a farm has animals but zero pedigree (no animal records a fatherId or
 * motherId), every pairing has COI = 0 by construction. The old code silently
 * returned the full cartesian product (e.g. 33,656 pairings at 0.0% COI),
 * which presents as a feature but is really a "no data" bug. Distinguishing
 * the NO_PEDIGREE_SEED case lets the page render a proper empty-state that
 * points the farmer at the pedigree importer, instead of firehosing junk.
 */
export type PairingEmptyReason = "NO_PEDIGREE_SEED" | "NO_BULLS" | "NO_OPEN_COWS";

export interface PairingResult {
  pairings: PairingSuggestion[];
  reason?: PairingEmptyReason;
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

// ============================================================
// Utility helpers
// ============================================================

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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ============================================================
// Breeding Snapshot (unchanged logic)
// ============================================================

export async function getBreedingSnapshot(
  prisma: PrismaClient,
  farmSlug: string,
): Promise<BreedingSnapshot> {
  void farmSlug;

  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
  const oneYearAgo = new Date(Date.now() - 365 * 86_400_000);
  const sixtyDaysFromNow = new Date(Date.now() + 60 * 86_400_000);
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 86_400_000);

  const [allAnimals, recentPregnancyScans, recentInseminations] = await Promise.all([
    prisma.animal.findMany({
      where: { status: "Active", species: "cattle" },
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

  const bulls = allAnimals.filter((a) => a.category === "Bull");
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
    (a) => a.sex === "Female" && (a.category === "Cow" || a.category === "Heifer"),
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

// ============================================================
// Inbreeding Detection
// ============================================================

export function detectInbreedingRisk(animals: AnimalRow[]): InbreedingRisk[] {
  const risks: InbreedingRisk[] = [];
  const animalMap = new Map(animals.map((a) => [a.id, a]));

  for (let i = 0; i < animals.length; i++) {
    const a = animals[i];
    for (let j = i + 1; j < animals.length; j++) {
      const b = animals[j];

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

      const aParents = [a.motherId, a.fatherId].filter(Boolean) as string[];
      const bParents = [b.motherId, b.fatherId].filter(Boolean) as string[];

      const aGrandparents = new Set<string>();
      for (const pid of aParents) {
        const p = animalMap.get(pid);
        if (p?.motherId) aGrandparents.add(p.motherId);
        if (p?.fatherId) aGrandparents.add(p.fatherId);
      }

      let hasShared = false;
      for (const pid of bParents) {
        if (hasShared) break;
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
            hasShared = true;
            break;
          }
        }
      }
    }
  }

  return risks;
}

// ============================================================
// COI Calculation — Wright's Path Method (up to 3 generations)
// ============================================================

/**
 * Calculate coefficient of inbreeding for a hypothetical offspring of animalA x animalB.
 * Uses Wright's path method, tracing all paths through common ancestors up to MAX_PEDIGREE_DEPTH.
 */
export function calculateCOI(
  animalA: AnimalRow,
  animalB: AnimalRow,
  allAnimals: AnimalRow[],
): number {
  const animalMap = new Map(allAnimals.map((a) => [a.id, a]));

  // Build ancestor maps: id -> set of paths (each path = list of IDs from animal to ancestor)
  function getAncestors(
    animalId: string,
    depth: number,
    currentPath: string[],
  ): Map<string, string[][]> {
    const result = new Map<string, string[][]>();
    if (depth === 0) return result;

    const animal = animalMap.get(animalId);
    if (!animal) return result;

    const parentIds = [animal.motherId, animal.fatherId].filter(Boolean) as string[];

    for (const parentId of parentIds) {
      const newPath = [...currentPath, parentId];

      // Add this parent as an ancestor
      const existing = result.get(parentId) ?? [];
      result.set(parentId, [...existing, newPath]);

      // Recurse for deeper ancestors
      const deeper = getAncestors(parentId, depth - 1, newPath);
      for (const [ancestorId, paths] of deeper.entries()) {
        const existingPaths = result.get(ancestorId) ?? [];
        result.set(ancestorId, [...existingPaths, ...paths]);
      }
    }

    return result;
  }

  // Get ancestors from both sides (from the perspective of a hypothetical offspring)
  const sireAncestors = getAncestors(animalA.id, MAX_PEDIGREE_DEPTH, [animalA.id]);
  const damAncestors = getAncestors(animalB.id, MAX_PEDIGREE_DEPTH, [animalB.id]);

  // Also include the parents themselves as ancestors of the offspring
  sireAncestors.set(animalA.id, [[animalA.id]]);
  damAncestors.set(animalB.id, [[animalB.id]]);

  // Find common ancestors
  let coi = 0;
  for (const [ancestorId, sirePaths] of sireAncestors.entries()) {
    const damPaths = damAncestors.get(ancestorId);
    if (!damPaths) continue;

    // For each pair of paths through a common ancestor, add (1/2)^(n1+n2+1)
    // where n1 = steps from sire to ancestor, n2 = steps from dam to ancestor
    for (const sirePath of sirePaths) {
      for (const damPath of damPaths) {
        const n1 = sirePath.length; // includes the starting animal
        const n2 = damPath.length;
        const pathLength = n1 + n2 - 1; // -1 because ancestor counted in both
        coi += Math.pow(0.5, pathLength);
      }
    }
  }

  return coi;
}

// ============================================================
// Trait Profile
// ============================================================

export async function getAnimalTraitProfile(
  prisma: PrismaClient,
  animalId: string,
  animalSex: string,
): Promise<TraitProfile> {
  const profile: TraitProfile = {
    birthWeight: null,
    calvingDifficultyAvg: null,
    bcsLatest: null,
    temperamentLatest: null,
    scrotalCirc: null,
    offspringCount: 0,
  };

  // Query all relevant observations for this animal
  const observations = await prisma.observation.findMany({
    where: {
      animalId,
      type: {
        in: [
          "calving",
          "body_condition_score",
          "temperament_score",
          "scrotal_circumference",
        ],
      },
    },
    orderBy: { observedAt: "desc" },
    select: { type: true, details: true, observedAt: true },
  });

  for (const obs of observations) {
    const d = parseDetails(obs.details);

    if (obs.type === "body_condition_score" && profile.bcsLatest === null) {
      const score = parseFloat(d.score ?? "");
      if (!isNaN(score)) profile.bcsLatest = score;
    }

    if (obs.type === "temperament_score" && profile.temperamentLatest === null) {
      const score = parseFloat(d.score ?? "");
      if (!isNaN(score)) profile.temperamentLatest = score;
    }

    if (obs.type === "scrotal_circumference" && profile.scrotalCirc === null) {
      const cm = parseFloat(d.measurement_cm ?? "");
      if (!isNaN(cm)) profile.scrotalCirc = cm;
    }
  }

  if (animalSex === "Male") {
    // For bulls: average calving difficulty of their calves
    // Find calving observations where the bull is the father.
    // Filter by `details LIKE %animalId%` to avoid a full table scan.
    const calvingObs = await prisma.observation.findMany({
      where: { type: "calving", details: { contains: animalId } },
      select: { details: true },
    });

    const difficulties: number[] = [];
    const birthWeights: number[] = [];
    let offspringCount = 0;

    for (const obs of calvingObs) {
      const d = parseDetails(obs.details);
      if (d.fatherId === animalId || d.bull_id === animalId) {
        offspringCount++;
        const diff = parseFloat(d.calving_difficulty ?? d.calvingDifficulty ?? "");
        if (!isNaN(diff)) difficulties.push(diff);
        const bw = parseFloat(d.birth_weight ?? d.birthWeight ?? "");
        if (!isNaN(bw)) birthWeights.push(bw);
      }
    }

    profile.offspringCount = offspringCount;
    if (difficulties.length > 0) {
      profile.calvingDifficultyAvg =
        difficulties.reduce((a, b) => a + b, 0) / difficulties.length;
    }
    if (birthWeights.length > 0) {
      profile.birthWeight =
        birthWeights.reduce((a, b) => a + b, 0) / birthWeights.length;
    }
  } else {
    // For cows: their own calving difficulty history
    const ownCalvings = await prisma.observation.findMany({
      where: { type: "calving", animalId },
      select: { details: true },
    });

    const difficulties: number[] = [];
    for (const obs of ownCalvings) {
      const d = parseDetails(obs.details);
      const diff = parseFloat(d.calving_difficulty ?? d.calvingDifficulty ?? "");
      if (!isNaN(diff)) difficulties.push(diff);
      // Use birth weight from the cow's own calving records
      if (profile.birthWeight === null) {
        const bw = parseFloat(d.birth_weight ?? d.birthWeight ?? "");
        if (!isNaN(bw)) profile.birthWeight = bw;
      }
    }

    profile.offspringCount = ownCalvings.length;
    if (difficulties.length > 0) {
      profile.calvingDifficultyAvg =
        difficulties.reduce((a, b) => a + b, 0) / difficulties.length;
    }
  }

  return profile;
}

// ============================================================
// Pairing Score Calculation
// ============================================================

function calculatePairingScore(
  coi: number,
  bullProfile: TraitProfile,
  cowProfile: TraitProfile,
  cowCategory: string,
): { score: number; reason: string; riskFlags: string[]; traitBreakdown: PairingSuggestion["traitBreakdown"] } {
  const riskFlags: string[] = [];
  const reasons: string[] = [];
  let totalScore = 70; // Base score for a viable pairing

  // --- Inbreeding penalty ---
  if (coi > COI_SOFT_LIMIT) {
    // Scale from 0 at 3.125% to -30 at 6.25%
    const penalty = ((coi - COI_SOFT_LIMIT) / (COI_HARD_LIMIT - COI_SOFT_LIMIT)) * 30;
    totalScore -= clamp(penalty, 0, 30);
    const coiPct = (coi * 100).toFixed(1);
    riskFlags.push(`High COI (${coiPct}%)`);
    reasons.push(`COI ${coiPct}% — elevated inbreeding risk`);
  } else if (coi > 0) {
    reasons.push(`COI ${(coi * 100).toFixed(1)}% — acceptable`);
  } else {
    reasons.push("No detected common ancestors — low inbreeding risk");
    totalScore += 5;
  }

  // --- Heifer safety: penalize high birth weight bulls ---
  if (cowCategory === "Heifer" && bullProfile.birthWeight !== null && bullProfile.birthWeight > HIGH_BIRTH_WEIGHT_KG) {
    totalScore -= 20;
    riskFlags.push(`Heifer + high BW bull (${bullProfile.birthWeight.toFixed(1)}kg avg)`);
    reasons.push("Bull produces heavy calves — risk for heifer");
  } else if (cowCategory === "Heifer") {
    reasons.push("Heifer pairing — monitoring birth weights recommended");
  }

  // --- Trait scores ---
  let growthScore: number | null = null;
  let fertilityScore: number | null = null;
  let calvingEaseScore: number | null = null;
  let temperamentScore: number | null = null;

  // Calving ease: lower difficulty avg = better (1 is best, 5 is worst)
  if (bullProfile.calvingDifficultyAvg !== null) {
    // Convert 1-5 difficulty to 0-100 score (1=100, 5=0)
    calvingEaseScore = clamp(((5 - bullProfile.calvingDifficultyAvg) / 4) * 100, 0, 100);
    if (bullProfile.calvingDifficultyAvg <= 1.5) {
      totalScore += 10;
      reasons.push("Bull has excellent calving ease record");
    } else if (bullProfile.calvingDifficultyAvg >= 3) {
      totalScore -= 10;
      riskFlags.push(`High avg calving difficulty (${bullProfile.calvingDifficultyAvg.toFixed(1)})`);
    }
  }

  // Growth: birth weight as proxy
  if (bullProfile.birthWeight !== null) {
    // Optimal birth weight: 30-36kg range. Penalize extremes.
    const bw = bullProfile.birthWeight;
    if (bw >= 30 && bw <= 36) {
      growthScore = 80;
      totalScore += 5;
    } else if (bw < 30) {
      growthScore = 50;
    } else {
      growthScore = clamp(100 - (bw - 36) * 5, 20, 70);
    }
  }

  // Temperament: lower is better (1 = docile)
  const bullTemp = bullProfile.temperamentLatest;
  const cowTemp = cowProfile.temperamentLatest;
  if (bullTemp !== null || cowTemp !== null) {
    const avgTemp = bullTemp !== null && cowTemp !== null
      ? (bullTemp + cowTemp) / 2
      : (bullTemp ?? cowTemp)!;
    temperamentScore = clamp(((5 - avgTemp) / 4) * 100, 0, 100);
    if (avgTemp <= 2) {
      totalScore += 5;
      reasons.push("Good temperament genetics");
    } else if (avgTemp >= 4) {
      totalScore -= 5;
      riskFlags.push("Poor temperament genetics");
    }
  }

  // BCS complementarity: ideally both in 5-7 range
  if (bullProfile.bcsLatest !== null && cowProfile.bcsLatest !== null) {
    const avgBcs = (bullProfile.bcsLatest + cowProfile.bcsLatest) / 2;
    if (avgBcs >= 5 && avgBcs <= 7) {
      totalScore += 5;
      reasons.push("Both animals in good body condition");
    } else if (avgBcs < 4) {
      totalScore -= 5;
      riskFlags.push("Poor body condition — may affect fertility");
    }
  }

  // Scrotal circumference bonus for bulls
  if (bullProfile.scrotalCirc !== null) {
    if (bullProfile.scrotalCirc >= 34) {
      totalScore += 5;
      fertilityScore = 85;
      reasons.push(`Good scrotal circumference (${bullProfile.scrotalCirc}cm)`);
    } else if (bullProfile.scrotalCirc >= 30) {
      fertilityScore = 60;
    } else {
      fertilityScore = 30;
      totalScore -= 5;
      riskFlags.push(`Low scrotal circumference (${bullProfile.scrotalCirc}cm)`);
    }
  }

  // Offspring count bonus: proven sire
  if (bullProfile.offspringCount >= 5) {
    totalScore += 5;
    reasons.push(`Proven sire (${bullProfile.offspringCount} calves on record)`);
  }

  const finalScore = clamp(Math.round(totalScore), 0, 100);

  return {
    score: finalScore,
    reason: reasons.join(". ") + ".",
    riskFlags,
    traitBreakdown: {
      growth: growthScore,
      fertility: fertilityScore,
      calvingEase: calvingEaseScore,
      temperament: temperamentScore,
    },
  };
}

// ============================================================
// In-memory profile builders (used by suggestPairings batch path)
// ============================================================

type TraitObsRow = { animalId: string | null; type: string; details: string };
type CalvingObsRow = { details: string };
type CowCalvingObsRow = { animalId: string | null; details: string };

function buildBullProfileInMemory(
  animalId: string,
  traitObs: TraitObsRow[],
  bullCalvingObs: CalvingObsRow[],
): TraitProfile {
  const profile: TraitProfile = {
    birthWeight: null,
    calvingDifficultyAvg: null,
    bcsLatest: null,
    temperamentLatest: null,
    scrotalCirc: null,
    offspringCount: 0,
  };

  for (const obs of traitObs) {
    if (obs.animalId !== animalId) continue;
    const d = parseDetails(obs.details);
    if (obs.type === "body_condition_score" && profile.bcsLatest === null) {
      const score = parseFloat(d.score ?? "");
      if (!isNaN(score)) profile.bcsLatest = score;
    }
    if (obs.type === "temperament_score" && profile.temperamentLatest === null) {
      const score = parseFloat(d.score ?? "");
      if (!isNaN(score)) profile.temperamentLatest = score;
    }
    if (obs.type === "scrotal_circumference" && profile.scrotalCirc === null) {
      const cm = parseFloat(d.measurement_cm ?? "");
      if (!isNaN(cm)) profile.scrotalCirc = cm;
    }
  }

  const difficulties: number[] = [];
  const birthWeights: number[] = [];
  let offspringCount = 0;

  for (const obs of bullCalvingObs) {
    const d = parseDetails(obs.details);
    if (d.fatherId === animalId || d.bull_id === animalId) {
      offspringCount++;
      const diff = parseFloat(d.calving_difficulty ?? d.calvingDifficulty ?? "");
      if (!isNaN(diff)) difficulties.push(diff);
      const bw = parseFloat(d.birth_weight ?? d.birthWeight ?? "");
      if (!isNaN(bw)) birthWeights.push(bw);
    }
  }

  profile.offspringCount = offspringCount;
  if (difficulties.length > 0) {
    profile.calvingDifficultyAvg = difficulties.reduce((a, b) => a + b, 0) / difficulties.length;
  }
  if (birthWeights.length > 0) {
    profile.birthWeight = birthWeights.reduce((a, b) => a + b, 0) / birthWeights.length;
  }

  return profile;
}

function buildCowProfileInMemory(
  animalId: string,
  traitObs: TraitObsRow[],
  cowCalvingObs: CowCalvingObsRow[],
): TraitProfile {
  const profile: TraitProfile = {
    birthWeight: null,
    calvingDifficultyAvg: null,
    bcsLatest: null,
    temperamentLatest: null,
    scrotalCirc: null,
    offspringCount: 0,
  };

  for (const obs of traitObs) {
    if (obs.animalId !== animalId) continue;
    const d = parseDetails(obs.details);
    if (obs.type === "body_condition_score" && profile.bcsLatest === null) {
      const score = parseFloat(d.score ?? "");
      if (!isNaN(score)) profile.bcsLatest = score;
    }
    if (obs.type === "temperament_score" && profile.temperamentLatest === null) {
      const score = parseFloat(d.score ?? "");
      if (!isNaN(score)) profile.temperamentLatest = score;
    }
  }

  const ownCalvings = cowCalvingObs.filter((obs) => obs.animalId === animalId);
  const difficulties: number[] = [];

  for (const obs of ownCalvings) {
    const d = parseDetails(obs.details);
    const diff = parseFloat(d.calving_difficulty ?? d.calvingDifficulty ?? "");
    if (!isNaN(diff)) difficulties.push(diff);
    if (profile.birthWeight === null) {
      const bw = parseFloat(d.birth_weight ?? d.birthWeight ?? "");
      if (!isNaN(bw)) profile.birthWeight = bw;
    }
  }

  profile.offspringCount = ownCalvings.length;
  if (difficulties.length > 0) {
    profile.calvingDifficultyAvg = difficulties.reduce((a, b) => a + b, 0) / difficulties.length;
  }

  return profile;
}

// ============================================================
// Pairing Suggestions (enhanced)
// ============================================================

export async function suggestPairings(
  prisma: PrismaClient,
  farmSlug: string,
): Promise<PairingResult> {
  void farmSlug;

  const oneYearAgo = new Date(Date.now() - 365 * 86_400_000);

  const [allAnimals, recentScans] = await Promise.all([
    prisma.animal.findMany({
      where: { status: "Active", species: "cattle" },
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

  // Gatekeeper: without *sufficient* pedigree seed data every COI is 0 and
  // every pairing looks equally "safe" — a 33,656-row cartesian product of
  // junk. A lone animal with a recorded sire in a 200-head herd is NOT
  // enough: the COI calculator still returns 0% for 99.9% of pairings and
  // the farmer sees a list that looks analytical but is meaningless.
  //
  // Threshold scales with herd size: require at least 10% of animals to
  // have a recorded sire or dam, floored at 1 so tiny pilot herds (<10
  // animals) still flow through with any pedigree signal. Above ~10
  // animals the 10% floor kicks in; a 200-head herd needs 20 with
  // pedigree before the engine runs.
  const pedigreeCount = allAnimals.reduce(
    (n, a) =>
      n +
      ((a.motherId && a.motherId.length > 0) || (a.fatherId && a.fatherId.length > 0) ? 1 : 0),
    0,
  );
  const requiredPedigree = Math.max(1, Math.ceil(allAnimals.length * 0.1));
  if (pedigreeCount < requiredPedigree) {
    return { pairings: [], reason: "NO_PEDIGREE_SEED" };
  }

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

  if (bulls.length === 0) return { pairings: [], reason: "NO_BULLS" };
  if (openCows.length === 0) return { pairings: [], reason: "NO_OPEN_COWS" };

  // Batch-fetch all trait observations in 3 queries instead of O(N) per-animal calls.
  const threeYearsAgo = new Date(Date.now() - 3 * 365 * 86_400_000);
  const allAnimalIds = [...bulls.map((b) => b.id), ...openCows.map((c) => c.id)];

  const [traitObs, cowCalvingObs, bullCalvingObs] = await Promise.all([
    // Trait observations (BCS, temperament, scrotal circumference) for all bulls + cows
    prisma.observation.findMany({
      where: {
        animalId: { in: allAnimalIds },
        type: { in: ["body_condition_score", "temperament_score", "scrotal_circumference"] },
      },
      orderBy: { observedAt: "desc" },
      select: { animalId: true, type: true, details: true },
    }),
    // Calving observations linked to cows (by animalId)
    prisma.observation.findMany({
      where: { animalId: { in: openCows.map((c) => c.id) }, type: "calving" },
      select: { animalId: true, details: true },
    }),
    // Calving observations for bull offspring detection (time-bounded, filtered in memory)
    prisma.observation.findMany({
      where: { type: "calving", observedAt: { gte: threeYearsAgo } },
      select: { details: true },
    }),
  ]);

  const profileCache = new Map<string, TraitProfile>();
  for (const bull of bulls) {
    profileCache.set(bull.id, buildBullProfileInMemory(bull.id, traitObs, bullCalvingObs));
  }
  for (const cow of openCows) {
    profileCache.set(cow.id, buildCowProfileInMemory(cow.id, traitObs, cowCalvingObs));
  }

  // Generate scored pairings
  const suggestions: PairingSuggestion[] = [];

  for (const bull of bulls) {
    const bullProfile = profileCache.get(bull.id)!;

    for (const cow of openCows) {
      // Calculate COI for hypothetical offspring
      const coi = calculateCOI(bull, cow, allAnimals);

      // Hard limit: skip if COI too high
      if (coi > COI_HARD_LIMIT) continue;

      const cowProfile = profileCache.get(cow.id)!;

      const { score, reason, riskFlags, traitBreakdown } = calculatePairingScore(
        coi,
        bullProfile,
        cowProfile,
        cow.category,
      );

      suggestions.push({
        bullId: bull.id,
        bullTag: bull.animalId,
        cowId: cow.id,
        cowTag: cow.animalId,
        score,
        coi,
        reason,
        riskFlags,
        traitBreakdown,
      });
    }
  }

  // Sort by score descending and limit
  suggestions.sort((a, b) => b.score - a.score);
  return { pairings: suggestions.slice(0, MAX_PAIRINGS) };
}
