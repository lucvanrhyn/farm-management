/**
 * Pure predicate deciding whether a Logger action button should be enabled
 * for a given animal. Issue #391 (W3 of PRD #389).
 *
 * Lives in a pure module — no React, no Prisma imports — so it can be:
 *   1. Reused by both the Logger UI (`AnimalChecklist`) and the server-side
 *      observation validator (so the UI cannot fall out of sync with the API
 *      contract).
 *   2. Table-tested in isolation in `canPerformAction.test.ts`.
 *
 * Rules (locked in tests):
 *   - `calving` requires `animal.sex === "Female"` AND the animal is not in a
 *     juvenile/pre-parturient category — i.e. not `Calf`, `Lamb`, `Ewe Lamb`
 *     or `Maiden Ewe` (a maiden has never lambed, so by definition cannot
 *     have a calving event).
 *   - `reproduction` requires the animal is not in a sexually-immature
 *     category — i.e. not `Calf`, `Lamb` or `Ewe Lamb`. `Maiden Ewe` is
 *     ALLOWED here (a maiden ewe can mate; she's just never given birth).
 *   - Every other action (`weigh`, `health`, `movement`, `treat`, `death`)
 *     is unconditionally allowed.
 *
 * Adding a new juvenile category is a single-line change to the registries
 * below.
 */

import type { AnimalSex, AnimalCategory } from "@/lib/types";

/**
 * The Logger action surface — mirrors the `ModalType` union in
 * `components/logger/AnimalChecklist.tsx` (the predicate is queried per
 * action button, so the type must enumerate every button the Logger renders).
 */
export type LoggerAction =
  | "health"
  | "weigh"
  | "treat"
  | "movement"
  | "calving"
  | "reproduction"
  | "death";

export type ActionEligibility =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/**
 * Categories where the animal has never given birth — calving is impossible.
 * Includes `Maiden Ewe` (a maiden has never lambed by definition).
 */
const CALVING_BLOCKED_CATEGORIES: readonly AnimalCategory[] = [
  "Calf",
  "Lamb",
  "Ewe Lamb",
  "Maiden Ewe",
];

/**
 * Categories that are sexually immature — reproduction events are impossible.
 * Excludes `Maiden Ewe` (mature enough to mate, just never lambed).
 */
const REPRODUCTION_BLOCKED_CATEGORIES: readonly AnimalCategory[] = [
  "Calf",
  "Lamb",
  "Ewe Lamb",
];

/**
 * Minimal animal shape the predicate inspects. Accepts both the canonical
 * `Animal` and the Prisma-shape `PrismaAnimal` (which also has `sex` +
 * `category`) by typing `sex` as the structural `AnimalSex` union.
 */
export interface LoggerActionAnimal {
  readonly sex: AnimalSex;
  readonly category: AnimalCategory;
}

/**
 * Decide whether `action` can be performed on `animal`.
 *
 * Returns a discriminated union so callers can render the reason directly
 * as tooltip / aria-description text without a second lookup.
 */
export function canPerformLoggerAction(
  animal: LoggerActionAnimal,
  action: LoggerAction,
): ActionEligibility {
  if (action === "calving") {
    if (animal.sex !== "Female") {
      return {
        allowed: false,
        reason: "Calving can only be logged on female animals.",
      };
    }
    if (CALVING_BLOCKED_CATEGORIES.includes(animal.category)) {
      return {
        allowed: false,
        reason: `Calving cannot be logged on a ${animal.category} (juvenile or pre-parturient).`,
      };
    }
    return { allowed: true };
  }

  if (action === "reproduction") {
    if (REPRODUCTION_BLOCKED_CATEGORIES.includes(animal.category)) {
      return {
        allowed: false,
        reason: `Reproduction cannot be logged on a ${animal.category} (sexually immature).`,
      };
    }
    return { allowed: true };
  }

  // Every other action — weigh, health, treat, movement, death — is
  // unconditionally allowed.
  return { allowed: true };
}
