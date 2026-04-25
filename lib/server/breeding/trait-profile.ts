// lib/server/breeding/trait-profile.ts
// Trait profile builders. Two surfaces:
//  - getAnimalTraitProfile(prisma, animalId, sex)   — DB-backed, single animal
//  - buildBullProfileInMemory / buildCowProfileInMemory — in-memory, used by
//    the batched suggestPairings path to avoid O(N) per-animal DB calls.

import type { PrismaClient } from "@prisma/client";
import type { TraitProfile } from "./types";
import { parseDetails } from "./utils";

export type TraitObsRow = { animalId: string | null; type: string; details: string };
export type CalvingObsRow = { details: string };
export type CowCalvingObsRow = { animalId: string | null; details: string };

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

export function buildBullProfileInMemory(
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

export function buildCowProfileInMemory(
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
