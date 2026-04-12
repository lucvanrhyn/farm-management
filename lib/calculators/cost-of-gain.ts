// Pure cost-of-gain calculator — no side effects, no imports.

export interface CogInputs {
  /** Total expense in R attributed to the scope (animal, camp, or farm) */
  totalCost: number;
  /** Total weight gained in kg across the same scope and period */
  kgGained: number;
}

export interface CogResult {
  /** R per kg gained. Null when kgGained is zero or negative. */
  costOfGain: number | null;
  totalCost: number;
  kgGained: number;
}

/**
 * Cost-of-gain categories are strings that match
 * `lib/constants/default-categories.ts` expense category names.
 * `all` applies no filter; `feed_vet` restricts to direct growing-period inputs.
 */
export const COG_SCOPE_CATEGORIES = {
  all: null,
  feed_vet: ["Feed/Supplements", "Medication/Vet"],
} as const satisfies Record<string, readonly string[] | null>;

export type CogScope = keyof typeof COG_SCOPE_CATEGORIES;

export const COG_SCOPES: readonly CogScope[] = ["all", "feed_vet"] as const;

export function isCogScope(value: string | null | undefined): value is CogScope {
  return value === "all" || value === "feed_vet";
}

export function calcCostOfGain(inputs: CogInputs): CogResult {
  const { totalCost, kgGained } = inputs;
  const costOfGain = kgGained > 0 ? totalCost / kgGained : null;
  return { costOfGain, totalCost, kgGained };
}

/** Returns the category allowlist for a scope, or null for "no filter". */
export function categoriesForScope(scope: CogScope): readonly string[] | null {
  return COG_SCOPE_CATEGORIES[scope];
}
