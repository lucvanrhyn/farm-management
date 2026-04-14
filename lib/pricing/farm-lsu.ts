import { getMergedLsuValues } from '@/lib/species/registry';
import { getPrismaForFarm } from '@/lib/farm-prisma';

export type SpeciesCounts = Record<string, number>;

/**
 * Pure helper: multiply species counts by their LSU weights, sum, round.
 * Species with no weight entry contribute zero. Negative counts / NaN are
 * the caller's problem — this is a hot-path math helper, not a validator.
 */
export function computeFarmLsuFromCounts(
  counts: SpeciesCounts,
  weights: Record<string, number>,
): number {
  let lsu = 0;
  for (const [species, count] of Object.entries(counts)) {
    const weight = weights[species];
    if (weight === undefined) continue;
    lsu += count * weight;
  }
  return Math.round(lsu);
}

/**
 * Compute a farm's current LSU from its active animal roster.
 *
 * Queries the per-tenant Prisma client via getPrismaForFarm(), counts
 * animals with status="Active" grouped by species, then applies the
 * shared species registry LSU weights via getMergedLsuValues().
 *
 * Throws if the farm slug is not found (consumer layers handle redirect).
 */
export async function computeFarmLsu(farmSlug: string): Promise<number> {
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) throw new Error(`Farm not found: ${farmSlug}`);

  const grouped = await prisma.animal.groupBy({
    by: ['species'],
    where: { status: 'Active' },
    _count: { _all: true },
  });

  const counts: SpeciesCounts = {};
  for (const row of grouped) {
    counts[row.species] = row._count._all;
  }

  const weights = getMergedLsuValues();
  return computeFarmLsuFromCounts(counts, weights);
}
