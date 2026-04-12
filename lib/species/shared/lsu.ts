// lib/species/shared/lsu.ts — Generic LSU calculation shared across species

/**
 * Calculate total Large Stock Units from a list of animals grouped by category.
 *
 * @param animalsByCategory - Array of { category, count } for animals in a camp/mob
 * @param lsuValues - Species-specific LSU lookup (e.g. { Cow: 1.0, Calf: 0.25 })
 * @param defaultLsu - Fallback LSU value for unknown categories (default 1.0)
 */
export function calcLsu(
  animalsByCategory: ReadonlyArray<{ category: string; count: number }>,
  lsuValues: Readonly<Record<string, number>>,
  defaultLsu: number = 1.0,
): number {
  return animalsByCategory.reduce(
    (sum, { category, count }) => sum + count * (lsuValues[category] ?? defaultLsu),
    0,
  );
}

/**
 * Calculate days of grazing remaining in a camp.
 *
 * Formula (SA standard):
 *   Effective FOO = kgDmPerHa × useFactor × sizeHectares
 *   LSU           = calcLsu(animalsByCategory, lsuValues)
 *   Days          = Effective FOO ÷ (LSU × 10 kg DM/LSU/day)
 *
 * Returns null when LSU = 0, no size, or no cover reading.
 */
export function calcDaysGrazingRemaining(
  kgDmPerHa: number,
  useFactor: number,
  sizeHectares: number,
  animalsByCategory: ReadonlyArray<{ category: string; count: number }>,
  lsuValues: Readonly<Record<string, number>>,
): number | null {
  if (sizeHectares <= 0 || kgDmPerHa <= 0) return null;
  const lsu = calcLsu(animalsByCategory, lsuValues);
  if (lsu <= 0) return null;
  const effectiveFoo = kgDmPerHa * useFactor * sizeHectares;
  return effectiveFoo / (lsu * 10);
}
