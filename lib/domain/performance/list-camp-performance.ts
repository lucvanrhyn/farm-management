/**
 * Wave G4 (#168) — domain op `listCampPerformance`.
 *
 * Owns the per-camp performance rollup that powers the
 * `/api/[farmSlug]/performance` GET — animal count, latest camp_condition
 * observation (grazing + fence), latest cover-reading category, and
 * stocking density (animals / hectares).
 *
 * Behaviour preserved verbatim from the pre-G4
 * `app/api/[farmSlug]/performance/route.ts` inline logic — only the file
 * location moved. Bulk-query strategy (4 queries regardless of camp count,
 * O(N) in-memory roll-up) is retained.
 */
import type { PrismaClient } from "@prisma/client";

export interface CampPerformanceRow {
  readonly campId: string;
  readonly campName: string;
  readonly sizeHectares: number | null;
  readonly animalCount: number;
  /** Animals per hectare to one decimal place; null when sizeHectares is 0 or null. */
  readonly stockingDensity: string | null;
  /** Most-recent camp_condition observation `details.grazing` value. */
  readonly grazingQuality: string | null;
  /** Most-recent camp_condition observation `details.fence` value. */
  readonly fenceStatus: string | null;
  /** ISO date (YYYY-MM-DD) of the most-recent camp_condition observation. */
  readonly lastInspection: string | null;
  /** Most-recent campCoverReading.coverCategory. */
  readonly coverCategory: string | null;
  /** ISO date (YYYY-MM-DD) of the most-recent campCoverReading. */
  readonly coverReadingDate: string | null;
}

/**
 * Builds the per-camp performance roll-up.
 *
 * Implementation notes:
 *   1. Fetch the camp list first so we know the IN-key for the bulk queries.
 *   2. Run the 3 bulk queries (animal groupBy + observation findMany + cover
 *      findMany) in parallel — 4 round-trips total regardless of camp count
 *      (was N+1 before this rollup).
 *   3. Build O(N) lookup maps in memory (camps are typically 10-200).
 *   4. Render each camp row, falling back to null/0 for missing rows.
 */
export async function listCampPerformance(
  prisma: PrismaClient,
): Promise<CampPerformanceRow[]> {
  // Step 1: fetch camp list (needed to scope IN-queries)
  const camps = await prisma.camp.findMany({ orderBy: { campId: "asc" } });
  const campIds = camps.map((c) => c.campId);

  if (campIds.length === 0) return [];

  // Step 2: fire all bulk queries in parallel — 4 queries regardless of camp count
  // (was N+1: 1 camp list + 3 queries per camp = 3N+1)
  const [animalGroups, allConditions, allCovers] = await Promise.all([
    // cross-species by design: per-camp performance rollup spans species.
    prisma.animal.groupBy({
      by: ["currentCamp"],
      where: { currentCamp: { in: campIds }, status: "Active" },
      _count: { _all: true },
    }),
    // Fetch all camp_condition records for these camps, newest first.
    // We pick the first occurrence per campId below (= latest) so ordering matters.
    prisma.observation.findMany({
      where: { campId: { in: campIds }, type: "camp_condition" },
      orderBy: { observedAt: "desc" },
      select: { campId: true, details: true, observedAt: true },
    }),
    prisma.campCoverReading.findMany({
      where: { campId: { in: campIds } },
      orderBy: { recordedAt: "desc" },
      select: { campId: true, coverCategory: true, recordedAt: true },
    }),
  ]);

  // Step 3: build lookup maps in memory (O(N) each, negligible vs. DB round-trips)
  const animalCountByCamp: Record<string, number> = {};
  for (const g of animalGroups) {
    if (g.currentCamp) animalCountByCamp[g.currentCamp] = g._count._all;
  }

  const latestConditionByCamp: Record<string, (typeof allConditions)[number]> = {};
  for (const c of allConditions) {
    if (!latestConditionByCamp[c.campId]) latestConditionByCamp[c.campId] = c;
  }

  const latestCoverByCamp: Record<string, (typeof allCovers)[number]> = {};
  for (const c of allCovers) {
    if (!latestCoverByCamp[c.campId]) latestCoverByCamp[c.campId] = c;
  }

  return camps.map((camp) => {
    const animalCount = animalCountByCamp[camp.campId] ?? 0;
    const latestCondition = latestConditionByCamp[camp.campId] ?? null;
    const latestCover = latestCoverByCamp[camp.campId] ?? null;
    const density =
      camp.sizeHectares && camp.sizeHectares > 0
        ? (animalCount / camp.sizeHectares).toFixed(1)
        : null;
    const details = (latestCondition?.details as unknown) as
      | Record<string, string>
      | null;
    return {
      campId: camp.campId,
      campName: camp.campName,
      sizeHectares: camp.sizeHectares,
      animalCount,
      stockingDensity: density,
      grazingQuality: details?.grazing ?? null,
      fenceStatus: details?.fence ?? null,
      lastInspection: latestCondition?.observedAt
        ? new Date(latestCondition.observedAt).toISOString().split("T")[0]
        : null,
      coverCategory: latestCover?.coverCategory ?? null,
      coverReadingDate: latestCover?.recordedAt
        ? new Date(latestCover.recordedAt).toISOString().split("T")[0]
        : null,
    };
  });
}
