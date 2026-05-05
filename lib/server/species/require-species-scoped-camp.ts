/**
 * lib/server/species/require-species-scoped-camp.ts
 *
 * Pure helper: given `(prisma, { species, farmSlug, campId })`, returns whether
 * the camp exists for that species inside the (already tenant-scoped) Prisma client.
 *
 * Spec: memory/multi-species-spec-2026-04-27.md
 *   "each species is a fully-isolated workspace inside one tenant"
 *   "Hard-block cross-species writes uniformly"
 *
 * Consumers:
 *   - #97  — mob orphan-camp hard-block (mob create/update)
 *   - #98  — animal cross-species PATCH hard-block
 *
 * Result outcomes:
 *   ok: true        — camp exists and its species matches the requested species.
 *   NOT_FOUND       — no camp with that campId exists in the tenant at all.
 *   WRONG_SPECIES   — a camp with that campId exists but belongs to a different
 *                     species (including orphaned rows where species is null).
 *
 * Implementation notes:
 *   1. The primary lookup uses the composite-unique key `(species, campId)` so
 *      the result is deterministic even when the same campId string exists
 *      across multiple species (Phase A of #28 multi-species refactor).
 *   2. When the primary lookup returns null (no row for this species+campId
 *      pair), a secondary `findFirst({ where: { campId } })` determines whether
 *      the camp simply does not exist (NOT_FOUND) or exists under a different
 *      species (WRONG_SPECIES). This two-query design avoids a full table scan
 *      and keeps the happy-path to a single composite-unique index hit.
 *   3. `farmSlug` is included in args for call-site readability and future
 *      audit logging. The Prisma client is already scoped to the tenant — no
 *      query predicate on farmSlug is needed.
 *
 * @module lib/server/species/require-species-scoped-camp
 */

import type { PrismaClient } from '@prisma/client';
import type { SpeciesId } from '@/lib/species/types';

// ── Public Types ──────────────────────────────────────────────────────────────

export type SpeciesScopedCampSuccess = {
  ok: true;
  camp: { id: string; species: string };
};

export type SpeciesScopedCampFailure = {
  ok: false;
  reason: 'NOT_FOUND' | 'WRONG_SPECIES';
};

export type SpeciesScopedCampResult =
  | SpeciesScopedCampSuccess
  | SpeciesScopedCampFailure;

export interface RequireSpeciesScopedCampArgs {
  /** The species the caller expects the camp to belong to. */
  species: SpeciesId;
  /**
   * Slug of the farm — passed for audit/logging purposes.
   * The prisma client is already tenant-scoped; this is not used in queries.
   */
  farmSlug: string;
  /** The business-key camp identifier (Camp.campId). */
  campId: string;
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Validates that a camp with the given `campId` exists AND belongs to the
 * expected `species` within the tenant-scoped `prisma` client.
 *
 * Returns a discriminated union so callers can type-narrow without try/catch:
 *
 * ```ts
 * const result = await requireSpeciesScopedCamp(prisma, { species, farmSlug, campId });
 * if (!result.ok) {
 *   // result.reason is 'NOT_FOUND' | 'WRONG_SPECIES'
 *   return apiError(result.reason);
 * }
 * // result.camp is { id, species }
 * ```
 *
 * @see memory/multi-species-spec-2026-04-27.md
 * @see issues #97 (mob create), #98 (animal PATCH)
 */
export async function requireSpeciesScopedCamp(
  prisma: PrismaClient,
  { species, campId }: RequireSpeciesScopedCampArgs,
): Promise<SpeciesScopedCampResult> {
  // Step 1: Composite-unique lookup — O(1) index hit.
  // If a camp exists for (species, campId), we're done.
  const camp = await prisma.camp.findUnique({
    where: {
      Camp_species_campId_key: { species, campId },
    },
    select: { id: true, species: true },
  });

  if (camp !== null) {
    return { ok: true, camp };
  }

  // Step 2: The (species, campId) pair does not exist.
  // Distinguish between "campId unknown" vs "campId exists under another species".
  const anyRow = await prisma.camp.findFirst({
    where: { campId },
    select: { id: true, species: true },
  });

  if (anyRow === null) {
    return { ok: false, reason: 'NOT_FOUND' };
  }

  // A row exists but its species differs (or is null — orphaned row).
  return { ok: false, reason: 'WRONG_SPECIES' };
}
