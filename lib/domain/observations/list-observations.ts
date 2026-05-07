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

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface ListObservationsFilters {
  camp?: string | null;
  type?: string | null;
  animalId?: string | null;
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
  return raw;
}

export async function listObservations(
  prisma: PrismaClient,
  filters: ListObservationsFilters,
): Promise<Observation[]> {
  const where: Record<string, unknown> = {};
  if (filters.camp) where.campId = filters.camp;
  if (filters.type) where.type = filters.type;
  if (filters.animalId) where.animalId = filters.animalId;

  return prisma.observation.findMany({
    where,
    orderBy: { observedAt: "desc" },
    take: clampLimit(filters.limit),
    skip: clampOffset(filters.offset),
  });
}
