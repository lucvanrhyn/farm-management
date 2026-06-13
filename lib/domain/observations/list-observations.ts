/**
 * Wave C (#156) — domain op `listObservations`.
 *
 * Returns observation rows for the calling tenant. The route adapter
 * supplies a tenant-scoped Prisma client; this op layers the filter
 * translation, pagination clamps, and order-by on top.
 *
 * Pagination invariants (preserved from the pre-Wave-C route handler):
 *   - `take` defaults to 50, hard-capped at 200 — bursty offline-sync
 *     clients cannot exfiltrate the whole table in one round trip.
 *   - `skip` defaults to 0; negative offsets clamp to 0.
 *
 * Wire shape is the raw Prisma `Observation` row — preserved verbatim so
 * the offline-sync queue and admin UI consumers remain compatible.
 */
import type { Observation, PrismaClient } from "@prisma/client";

import { crossSpecies } from "@/lib/server/species-scoped-prisma";

/**
 * Pagination tunables — exported (#485) so the route adapter can feed the
 * SAME caps into the shared `parseLimit` validator at the boundary, keeping
 * one source of truth. `DEFAULT_LIMIT` is the fallback for an omitted
 * `?limit`; `MAX_LIMIT` is the hard cap a valid limit clamps to.
 */
export const OBSERVATIONS_DEFAULT_LIMIT = 50;
export const OBSERVATIONS_MAX_LIMIT = 200;
/**
 * Hard cap on `skip` (api-L1). `clampOffset` already rejected NaN/negative, but
 * — unlike `clampLimit` — left the offset unbounded, so a caller could force an
 * arbitrarily deep `skip` (e.g. `?offset=99999999`), making libSQL scan-and-
 * discard millions of rows. Capping mirrors `MAX_LIMIT`'s "no whole-table
 * scan / exfil" rationale; 100k sits far beyond any real tenant's row count.
 */
export const OBSERVATIONS_MAX_OFFSET = 100_000;

const DEFAULT_LIMIT = OBSERVATIONS_DEFAULT_LIMIT;
const MAX_LIMIT = OBSERVATIONS_MAX_LIMIT;
const MAX_OFFSET = OBSERVATIONS_MAX_OFFSET;

export interface ListObservationsFilters {
  camp?: string | null;
  type?: string | null;
  animalId?: string | null;
  /**
   * Issue #491 — OPT-IN species narrowing, mirroring `/api/animals`. When
   * absent the op stays the cross-species rollup (#356 invariant): the
   * `species` predicate is applied ONLY when this is present. The column is
   * already denormalised + indexed on `Observation` (migration 0003), so no
   * schema/migration is needed.
   */
  species?: string | null;
  limit?: number | null;
  offset?: number | null;
}

function clampLimit(raw: number | null | undefined): number {
  if (raw === null || raw === undefined || Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(raw, MAX_LIMIT);
}

function clampOffset(raw: number | null | undefined): number {
  if (raw === null || raw === undefined || Number.isNaN(raw) || raw < 0) {
    return 0;
  }
  return Math.min(raw, MAX_OFFSET);
}

export async function listObservations(
  prisma: PrismaClient,
  filters: ListObservationsFilters,
): Promise<Observation[]> {
  const where: Record<string, unknown> = {};
  if (filters.camp) where.campId = filters.camp;
  if (filters.type) where.type = filters.type;
  if (filters.animalId) where.animalId = filters.animalId;
  // Issue #491 — opt-in species narrowing. Applied ONLY when present so the
  // default (omitted) path stays the cross-species rollup (#356).
  if (filters.species) where.species = filters.species;

  return crossSpecies(prisma, "analytics-rollup").observation.findMany({
    where,
    orderBy: { observedAt: "desc" },
    take: clampLimit(filters.limit),
    skip: clampOffset(filters.offset),
  });
}
