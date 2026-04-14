import { calcLsu } from '@/lib/species/shared/lsu';
import { getMergedLsuValues } from '@/lib/species/registry';
import { getPrismaForFarm } from '@/lib/farm-prisma';

/** A counted bucket of animals sharing a category (e.g. { category: 'Cow', count: 100 }). */
export interface CategoryBucket {
  readonly category: string;
  readonly count: number;
}

/** A GameSpecies population row for LSU summation. */
export interface GameSpeciesPopulation {
  readonly population: number;
  readonly lsuEquivalent: number;
}

/**
 * Compute a farm's total LSU from already-queried roster data.
 *
 * Pure. Sums cattle/sheep (+ individually-tracked game) via calcLsu against
 * category-keyed weights, then adds game-species population LSU from the
 * GameSpecies table. Rounds once at the end to avoid drift from per-source
 * rounding.
 *
 * Exposed separately from computeFarmLsu() so tests can exercise the math
 * without mocking Prisma.
 */
export function computeFarmLsuFromQueryResults(
  animalsByCategory: ReadonlyArray<CategoryBucket>,
  gameSpeciesPopulations: ReadonlyArray<GameSpeciesPopulation>,
  lsuValues: Readonly<Record<string, number>>,
): number {
  const animalLsu = calcLsu(animalsByCategory, lsuValues);
  let gameLsu = 0;
  for (const g of gameSpeciesPopulations) {
    gameLsu += g.population * g.lsuEquivalent;
  }
  return Math.round(animalLsu + gameLsu);
}

interface RawGameSpeciesRow {
  currentEstimate: bigint | number | null;
  lsuEquivalent: number | null;
}

function toNum(v: bigint | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === 'bigint' ? Number(v) : v;
}

/**
 * Compute a farm's current LSU from its active roster.
 *
 * Two data sources:
 *  1. Animal table — grouped by category (NOT species). Weights from
 *     getMergedLsuValues(). Covers cattle, sheep, and individually-tracked
 *     game animals.
 *  2. GameSpecies table — raw SQL since this table is not in the Prisma
 *     schema. Covers population-only game species (the common case).
 *
 * Throws if the farm slug is not found (consumer layers handle redirect).
 *
 * WARNING: computeFarmLsu() is async and hits two DB reads. Cache the
 * result at the page level if you need it multiple times per render.
 */
export async function computeFarmLsu(farmSlug: string): Promise<number> {
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) throw new Error(`Farm not found: ${farmSlug}`);

  const [animalGroups, gameRows] = await Promise.all([
    prisma.animal.groupBy({
      by: ['category'],
      where: { status: 'Active' },
      _count: { _all: true },
    }),
    prisma.$queryRawUnsafe<RawGameSpeciesRow[]>(
      `SELECT currentEstimate, lsuEquivalent FROM GameSpecies`,
    ).catch(() => [] as RawGameSpeciesRow[]),
  ]);

  const animalsByCategory: CategoryBucket[] = animalGroups.map((row) => ({
    category: row.category,
    count: row._count._all,
  }));

  const gameSpeciesPopulations: GameSpeciesPopulation[] = gameRows.map((row) => ({
    population: toNum(row.currentEstimate),
    lsuEquivalent: row.lsuEquivalent ?? 0,
  }));

  return computeFarmLsuFromQueryResults(
    animalsByCategory,
    gameSpeciesPopulations,
    getMergedLsuValues(),
  );
}
