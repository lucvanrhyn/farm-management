/**
 * lib/domain/camp/inspection-freshness.ts
 *
 * Issue #437 — species-scoped "last inspected at" probe for a single camp.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Why this file exists
 * ──────────────────────────────────────────────────────────────────────
 *
 * The Trio "0 animals · Just now" bug class: on Trio (a tenant whose data
 * is cattle-only), the Sheep Logger painted 19 misleading camp tiles each
 * stamped with the cattle camp's most recent inspection time ("Just now")
 * even though no sheep inspection ever happened. Root cause: the
 * `/api/camps/status` route returned the latest inspection observation per
 * camp WITHOUT scoping by `species`, so the cattle inspection silently bled
 * into the sheep view.
 *
 * This module is the species-aware probe that the
 * `/api/camps?species=<mode>` route uses to fill `last_inspected_at` per
 * camp. The species predicate is enforced through ADR-0005's
 * `scoped(prisma, species)` door — i.e. forgetting it is a *compile* error
 * (the door's positional `species` argument is required), not a silent
 * runtime leak.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Contract
 * ──────────────────────────────────────────────────────────────────────
 *
 *   getLastInspectionAt(prisma, campId, species)
 *
 *   - Returns the ISO timestamp string of the latest observation whose
 *     `campId === campId`, `type ∈ {camp_check, camp_condition}` AND whose
 *     `species` column equals `species`.
 *   - Returns `null` when no species-matching inspection exists (even if
 *     the camp has rows for a different species).
 *
 * The inspection-type literal set is shared with the producer (Logger
 * submit handlers) and the cross-species consumer (`getLatestCampConditions`
 * in `lib/server/camp-status.ts`) via the hoisted
 * `CAMP_INSPECTION_OBSERVATION_TYPES` constant from #407 — adding a third
 * inspection branch updates every callsite atomically.
 */
import type { PrismaClient } from "@prisma/client";

import { scoped } from "@/lib/server/species-scoped-prisma";
import type { SpeciesId } from "@/lib/species/types";
import { CAMP_INSPECTION_OBSERVATION_TYPES } from "@/lib/observations/camp-inspection-types";

/**
 * Return the ISO timestamp of the latest `camp_check` / `camp_condition`
 * observation logged for `campId` under `species`, or `null` if none exists.
 *
 * Uses `scoped(prisma, species).observation.findFirst` so the species
 * predicate is structurally injected (ADR-0005). Sorted by `observedAt`
 * desc + `take: 1` via `findFirst` — at most one row crosses the wire.
 */
export async function getLastInspectionAt(
  prisma: PrismaClient,
  campId: string,
  species: SpeciesId,
): Promise<string | null> {
  const row = await scoped(prisma, species).observation.findFirst({
    where: {
      campId,
      type: { in: [...CAMP_INSPECTION_OBSERVATION_TYPES] },
    },
    orderBy: { observedAt: "desc" },
  });

  if (!row) return null;

  // Some Prisma adapters surface dates as Date objects, others as ISO
  // strings. Normalise to a single ISO string so the route handler can
  // serialise the field uniformly without per-call branching.
  const observedAt = row.observedAt;
  return observedAt instanceof Date ? observedAt.toISOString() : observedAt;
}

/**
 * Pure predicate — when should the Logger camp list render the
 * "no sheep mob structure yet" empty-state banner?
 *
 * The Trio "0 animals · Just now" misleading-tile class fires when the
 * tenant has cattle-only data but the FarmMode is sheep. The picker
 * (`<CampSelector />`) sees 19 allowed camps from the cross-species
 * `resolveAllowedCampIds` resolver but every one has species-scoped
 * `animal_count === 0`. Pre-fix this rendered 19 "0 animals · Just now"
 * cards; post-fix the page renders a single empty-state banner so the
 * field worker sees one clear "no sheep structure yet" message instead
 * of a misleading grid.
 *
 * Returns `true` iff:
 *   - the FarmMode is `"sheep"`, AND
 *   - the camps list is non-empty (we have something to count), AND
 *   - every camp's `animal_count` is exactly 0.
 *
 * The gate is sheep-only because cattle is the SARS / "default" tier on
 * a cattle-only tenant (a brand-new farm with no cattle yet ships
 * cattle-mode by default + an admin onboarding flow that points the user
 * to creating cattle). Sheep mode on a cattle-only tenant is the
 * documented anti-pattern; the banner exists for that case.
 *
 * Game mode is left out intentionally — game is a population-tracked
 * species (no per-animal head count) so `animal_count === 0` carries
 * different meaning there.
 */
export function shouldRenderSheepEmptyState(
  mode: string,
  camps: ReadonlyArray<{ animal_count?: number | null }>,
): boolean {
  if (mode !== "sheep") return false;
  if (camps.length === 0) return false;
  return camps.every((c) => (c.animal_count ?? 0) === 0);
}
