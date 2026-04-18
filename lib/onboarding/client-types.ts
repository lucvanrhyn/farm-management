/**
 * Client-facing types for the AI Import Wizard (Workstream B frontend).
 *
 * Re-exports the backend contract types so wizard components never import
 * server-only modules directly. Keeping everything the client needs in one
 * file makes dependency boundaries explicit and prevents accidental
 * server-code pulls into the browser bundle.
 */

// Re-export backend types so wizard consumers depend on a single module.
export type {
  ProposalResult,
  MappingProposal,
  ColumnMapping,
  UnmappedColumn,
} from "@/lib/onboarding/adaptive-import";
export type {
  ImportRow,
  CommitImportProgress,
  CommitImportResult,
} from "@/lib/onboarding/commit-import";

import type { ProposalResult } from "@/lib/onboarding/adaptive-import";
import type {
  CommitImportProgress,
  CommitImportResult,
} from "@/lib/onboarding/commit-import";

// ---------------------------------------------------------------------------
// Wizard-specific types
// ---------------------------------------------------------------------------

export type OnboardingSpecies = "cattle" | "sheep" | "goats" | "game";

export type OnboardingStep =
  | "welcome"
  | "upload"
  | "mapping"
  | "import"
  | "done";

export const STEP_ORDER: OnboardingStep[] = [
  "welcome",
  "upload",
  "mapping",
  "import",
  "done",
];

export function stepIndex(step: OnboardingStep): number {
  return STEP_ORDER.indexOf(step);
}

export type FileMeta = {
  name: string;
  size: number;
  /** lowercase hex sha-256 digest */
  hashHex: string;
};

/**
 * Aliases for the backend SSE frame types. Wizard code uses the shorter
 * "Frame" names but the shape is sourced from commit-import.ts, so any
 * future field addition on the backend propagates automatically instead
 * of silently diverging (see Phase 1 code review HIGH #3).
 */
export type CommitProgressFrame = CommitImportProgress;
export type CommitResultFrame = CommitImportResult;

export type OnboardingState = {
  species: OnboardingSpecies;
  file: FileMeta | null;
  parsedColumns: string[];
  sampleRows: Record<string, unknown>[];
  fullRowCount: number;
  proposal: ProposalResult | null;
  /** User overrides on the AI mapping — key is source column, value is target field or "__ignored__". */
  mappingOverrides: Record<string, string>;
  /** User manually mapping a column the AI left unmapped. */
  unmappedOverrides: Record<string, string>;
  importJobId: string | null;
  progress: CommitProgressFrame | null;
  result: CommitResultFrame | null;
};
