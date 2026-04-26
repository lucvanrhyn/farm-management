// lib/server/breeding/scoring.ts
// Score-and-explain a single sire x dam pairing given pre-computed trait
// profiles and the COI for the hypothetical offspring.
//
// Phase F: the heifer-safety penalty (high birth weight × young dam) is now
// parameterised per species. Cattle keep the historical 38 kg / "Heifer"
// thresholds; sheep flag oversized lambs paired with maiden ewes; game
// retains the shape but the rule rarely fires in practice (population
// tracking).

import type { PairingSuggestion, TraitProfile } from "./types";
import { COI_HARD_LIMIT, COI_SOFT_LIMIT } from "./constants";
import { clamp } from "./utils";

export interface PairingScoreOptions {
  /** Dam category that triggers the high-birth-weight safety penalty (e.g. "Heifer"). */
  youngFemaleCategory: string;
  /** Birth weight (kg) above which the sire is flagged risky for young dams. */
  highBirthWeightKg: number;
}

export function calculatePairingScore(
  coi: number,
  bullProfile: TraitProfile,
  cowProfile: TraitProfile,
  cowCategory: string,
  options: PairingScoreOptions,
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

  // --- Young-dam safety: penalize high birth weight sires ---
  if (
    cowCategory === options.youngFemaleCategory &&
    bullProfile.birthWeight !== null &&
    bullProfile.birthWeight > options.highBirthWeightKg
  ) {
    totalScore -= 20;
    riskFlags.push(
      `${options.youngFemaleCategory} + high BW sire (${bullProfile.birthWeight.toFixed(1)}kg avg)`,
    );
    reasons.push("Sire produces heavy offspring — risk for young dam");
  } else if (cowCategory === options.youngFemaleCategory) {
    reasons.push(`${options.youngFemaleCategory} pairing — monitor birth weights`);
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
