// lib/server/breeding/pairings.ts
// Top-N enhanced pairing suggestions: gates on pedigree-seed signal,
// batches all trait observations into 3 queries, then scores and ranks.
//
// Cattle-only by design (per Wave-3 audit: this lib is consumed only from
// cattle-only surfaces — `where: { species: "cattle" }` is intentional).

import type { PrismaClient } from "@prisma/client";
import type { PairingResult, PairingSuggestion, TraitProfile } from "./types";
import { COI_HARD_LIMIT, MAX_PAIRINGS } from "./constants";
import { parseDetails } from "./utils";
import { calculateCOI } from "./inbreeding";
import { calculatePairingScore } from "./scoring";
import {
  buildBullProfileInMemory,
  buildCowProfileInMemory,
} from "./trait-profile";

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
