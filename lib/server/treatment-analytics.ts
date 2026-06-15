// lib/server/treatment-analytics.ts
import type { PrismaClient } from "@prisma/client";
import { crossSpecies } from "@/lib/server/species-scoped-prisma";

// ADR-0005 Wave 2: withdrawal tracking spans every treated species
// (withdrawal periods are drug-driven, not species-driven).
// crossSpecies() forwards args verbatim — behaviour is identical.

// Default withdrawal periods in days per treatment type
const DEFAULT_WITHDRAWAL_DAYS: Record<string, number> = {
  Antibiotic: 14,
  Dip: 7,
  Deworming: 7,
  Vaccination: 0,
  Supplement: 0,
  Other: 7,
};

export interface WithdrawalAnimal {
  animalId: string;
  /**
   * The animal's TRUE species, looked up from its Animal row (not inferred).
   * Withdrawal tracking is cross-species (drug-driven), so consumers that are
   * species-aware — e.g. Herd Triage, which excludes population-tracked game —
   * must filter on the real species rather than guessing. (#356 mislabel class)
   */
  species: string;
  name: string | null;
  campId: string;
  treatmentType: string;
  treatedAt: Date;
  withdrawalDays: number;
  withdrawalEndsAt: Date;
  daysRemaining: number;
}

function parseDetails(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export async function getAnimalsInWithdrawal(
  prisma: PrismaClient
): Promise<WithdrawalAnimal[]> {
  const now = new Date();

  // Fetch all treatment observations that have an associated animal
  const treatmentObs = await crossSpecies(prisma, "analytics-rollup").observation.findMany({
    where: {
      type: "treatment",
      animalId: { not: null },
    },
    orderBy: { observedAt: "desc" },
    select: {
      id: true,
      animalId: true,
      campId: true,
      details: true,
      observedAt: true,
    },
  });

  if (treatmentObs.length === 0) return [];

  // Get unique animal IDs and look up only active animals
  const animalIds = [...new Set(treatmentObs.map((o) => o.animalId as string))];

  // cross-species by design: withdrawal periods apply to any treated
  // species. crossSpecies() forwards args verbatim (no injection).
  const activeAnimals = await crossSpecies(prisma, "analytics-rollup").animal.findMany({
    where: {
      animalId: { in: animalIds },
      status: "Active",
    },
    select: {
      animalId: true,
      name: true,
      species: true,
    },
  });

  const activeAnimalMap = new Map(
    activeAnimals.map((a) => [a.animalId, { name: a.name, species: a.species }])
  );

  // For each active animal, find their most recent treatment that still has a withdrawal window open
  // Use a map keyed by animalId to track the most-urgent (earliest ending) active withdrawal
  const activeWithdrawals = new Map<string, WithdrawalAnimal>();

  for (const obs of treatmentObs) {
    const animalId = obs.animalId as string;

    // Skip if animal is not active
    if (!activeAnimalMap.has(animalId)) continue;

    const details = parseDetails(obs.details);
    const treatmentType = typeof details.treatment_type === "string"
      ? details.treatment_type
      : "Other";

    const withdrawalDays =
      typeof details.withdrawal_days === "number"
        ? details.withdrawal_days
        : typeof details.withdrawal_days === "string" && !isNaN(Number(details.withdrawal_days))
        ? Number(details.withdrawal_days)
        : (DEFAULT_WITHDRAWAL_DAYS[treatmentType] ?? 7);

    // Zero withdrawal period — animal is never "in withdrawal" for this treatment
    if (withdrawalDays === 0) continue;

    const withdrawalEndsAt = addDays(obs.observedAt, withdrawalDays);

    // Check if still in withdrawal window
    if (withdrawalEndsAt <= now) continue;

    const daysRemaining = Math.ceil(
      (withdrawalEndsAt.getTime() - now.getTime()) / 86_400_000
    );

    // Keep the entry with the earliest withdrawal end (most urgent) per animal
    const existing = activeWithdrawals.get(animalId);
    if (!existing || withdrawalEndsAt < existing.withdrawalEndsAt) {
      const active = activeAnimalMap.get(animalId);
      activeWithdrawals.set(animalId, {
        animalId,
        species: active?.species ?? "cattle",
        name: active?.name ?? null,
        campId: obs.campId,
        treatmentType,
        treatedAt: obs.observedAt,
        withdrawalDays,
        withdrawalEndsAt,
        daysRemaining,
      });
    }
  }

  // Sort by withdrawalEndsAt ascending (most urgent first)
  return Array.from(activeWithdrawals.values()).sort(
    (a, b) => a.withdrawalEndsAt.getTime() - b.withdrawalEndsAt.getTime()
  );
}

export async function getWithdrawalCount(prisma: PrismaClient): Promise<number> {
  const animals = await getAnimalsInWithdrawal(prisma);
  return animals.length;
}
