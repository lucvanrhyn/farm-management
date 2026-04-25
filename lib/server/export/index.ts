// lib/server/export/index.ts
// Public API for the resource-specific export modules. The route file
// (`app/api/[farmSlug]/export/route.ts`) auth-checks, rate-limits, then
// dispatches to the matching exporter via this map.

import type { ExportArtifact, ExportContext } from "./types";
import { exportAnimals } from "./animals";
import { exportCalvings } from "./calvings";
import { exportCamps } from "./camps";
import { exportCostOfGain } from "./cost-of-gain";
import { exportDrought } from "./drought";
import { exportFeedOnOffer } from "./feed-on-offer";
import { exportPerformance } from "./performance";
import { exportReproduction } from "./reproduction";
import { exportRotationPlan } from "./rotation-plan";
import { exportSarsIt3 } from "./sars-it3";
import { exportTransactions } from "./transactions";
import { exportVeldScore } from "./veld-score";
import { exportWeightHistory } from "./weight-history";
import { exportWithdrawal } from "./withdrawal";

export type ExportType =
  | "animals"
  | "withdrawal"
  | "calvings"
  | "camps"
  | "transactions"
  | "weight-history"
  | "reproduction"
  | "performance"
  | "rotation-plan"
  | "cost-of-gain"
  | "veld-score"
  | "feed-on-offer"
  | "drought"
  | "sars-it3";

/** Tier-gated exporters — Advanced (paid) tier or above. */
export const ADVANCED_ONLY_EXPORTS = new Set<ExportType>([
  "rotation-plan",
  "cost-of-gain",
  "veld-score",
  "performance",
  "reproduction",
  "drought",
  "sars-it3",
]);

const EXPORTERS: Record<ExportType, (ctx: ExportContext) => Promise<ExportArtifact>> = {
  animals: exportAnimals,
  withdrawal: exportWithdrawal,
  calvings: exportCalvings,
  camps: exportCamps,
  transactions: exportTransactions,
  "weight-history": exportWeightHistory,
  reproduction: exportReproduction,
  performance: exportPerformance,
  "rotation-plan": exportRotationPlan,
  "cost-of-gain": exportCostOfGain,
  "veld-score": exportVeldScore,
  "feed-on-offer": exportFeedOnOffer,
  drought: exportDrought,
  "sars-it3": exportSarsIt3,
};

export function isExportType(value: string): value is ExportType {
  return value in EXPORTERS;
}

export function dispatchExport(type: ExportType, ctx: ExportContext): Promise<ExportArtifact> {
  return EXPORTERS[type](ctx);
}

export type { ExportArtifact, ExportContext, ExportFormat } from "./types";
export { ExportRequestError } from "./types";
