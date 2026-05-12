/**
 * Wave B (#151) — domain op `listMobs`.
 *
 * Returns the per-tenant mob list with derived `animal_count` for each mob.
 * Pure function on `(prisma, mode)` — the adapter (`tenantRead`) supplies
 * the tenant-scoped Prisma client; the route handler supplies the active
 * FarmMode read from the cookie via `getFarmMode(slug)`.
 *
 * Wave 226 (#226 / PRD #222): the list is species-scoped via the facade
 * from #224. Previously the call was farm-wide ("cross-species by design")
 * which violated #28 AC — the admin mobs page already filters per species,
 * the GET endpoint was the last surface that didn't.
 *
 * Wire shape (snake_case) is preserved from the pre-Wave-B route handler so
 * the migrated GET /api/mobs response is byte-identical:
 *
 *   { id, name, current_camp, animal_count }[]
 */
import type { PrismaClient } from "@prisma/client";
import type { SpeciesId } from "@/lib/species/types";
import { scoped } from "@/lib/server/species-scoped-prisma";

export interface ListMobsResult {
  id: string;
  name: string;
  current_camp: string;
  animal_count: number;
}

export async function listMobs(
  prisma: PrismaClient,
  mode: SpeciesId,
): Promise<ListMobsResult[]> {
  const sp = scoped(prisma, mode);
  const [mobs, animalGroups] = (await Promise.all([
    sp.mob.findMany({ orderBy: { name: "asc" } }),
    // Facade injects `species: mode` so the per-mob count tallies only the
    // active species — matches the mob list above row-for-row.
    sp.animal.groupBy({
      by: ["mobId"],
      where: { status: "Active", mobId: { not: null } },
      _count: { _all: true },
    }),
  ])) as [
    Array<{ id: string; name: string; currentCamp: string }>,
    // The facade returns the broad Prisma return shape for groupBy (see
    // species-scoped-prisma JSDoc § Builder shapes). Narrow at the
    // call-site to the shape we asked for via `by` + `_count._all`.
    Array<{ mobId: string | null; _count: { _all: number } }>,
  ];

  const countByMob: Record<string, number> = {};
  for (const g of animalGroups) {
    if (g.mobId) countByMob[g.mobId] = g._count._all;
  }

  return mobs.map((mob) => ({
    id: mob.id,
    name: mob.name,
    current_camp: mob.currentCamp,
    animal_count: countByMob[mob.id] ?? 0,
  }));
}
