/**
 * Wave B (#151) — domain op `listMobs`.
 *
 * Returns the per-tenant mob list with derived `animal_count` for each mob.
 * Pure function on `(prisma)` — the adapter (`tenantRead`) supplies the
 * tenant-scoped Prisma client.
 *
 * Wire shape (snake_case) is preserved from the pre-Wave-B route handler so
 * the migrated GET /api/mobs response is byte-identical:
 *
 *   { id, name, current_camp, animal_count }[]
 */
import type { PrismaClient } from "@prisma/client";

export interface ListMobsResult {
  id: string;
  name: string;
  current_camp: string;
  animal_count: number;
}

export async function listMobs(prisma: PrismaClient): Promise<ListMobsResult[]> {
  const [mobs, animalGroups] = await Promise.all([
    prisma.mob.findMany({ orderBy: { name: "asc" } }),
    // cross-species by design: mob list aggregates all species mob memberships.
    prisma.animal.groupBy({
      by: ["mobId"],
      where: { status: "Active", mobId: { not: null } },
      _count: { _all: true },
    }),
  ]);

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
