/**
 * Wave B (#151) — domain op `attachAnimalsToMob`.
 *
 * Attaches a set of animals to a mob, hard-blocking cross-species
 * assignment via `species: mob.species` on the updateMany filter. The
 * response shape echoes Wave 4 A3 (Codex adversarial review 2026-05-02 HIGH):
 * when actual < requested, surface `requested` + `mismatched` so UIs can
 * warn the user that some animals were rejected (wrong species / wrong
 * status / nonexistent).
 */
import type { PrismaClient } from "@prisma/client";

import { MobNotFoundError } from "./move-mob";
import { RouteValidationError } from "@/lib/server/route";
import { scoped } from "@/lib/server/species-scoped-prisma";
import type { SpeciesId } from "@/lib/species/types";

export interface AttachAnimalsInput {
  mobId: string;
  animalIds: string[];
}

export type AttachAnimalsResult =
  | { success: true; count: number }
  | { success: true; count: number; requested: number; mismatched: number };

function buildResponseBody(
  actualCount: number,
  requestedCount: number,
): AttachAnimalsResult {
  if (actualCount === requestedCount) {
    return { success: true, count: actualCount };
  }
  return {
    success: true,
    count: actualCount,
    requested: requestedCount,
    mismatched: requestedCount - actualCount,
  };
}

export async function attachAnimalsToMob(
  prisma: PrismaClient,
  input: AttachAnimalsInput,
): Promise<AttachAnimalsResult> {
  const mob = await prisma.mob.findUnique({ where: { id: input.mobId } });
  if (!mob) throw new MobNotFoundError(input.mobId);

  if (!Array.isArray(input.animalIds) || input.animalIds.length === 0) {
    throw new RouteValidationError("animalIds array is required", {
      fieldErrors: { animalIds: "animalIds array is required" },
    });
  }

  // #28 Phase B / Wave 4 A3 — hard-block cross-species mob assignment by
  // filtering on mob.species. Without this clause a sheep could be silently
  // attached to a cattle mob. Routed through scoped(prisma, mob.species)
  // so the species predicate is injected structurally; updateMany injects
  // species only (no status), so the explicit status: "Active" is kept.
  const { count } = await scoped(
    prisma,
    mob.species as SpeciesId,
  ).animal.updateMany({
    where: {
      animalId: { in: input.animalIds },
      status: "Active",
    },
    data: { mobId: input.mobId, currentCamp: mob.currentCamp },
  });

  return buildResponseBody(count, input.animalIds.length);
}
