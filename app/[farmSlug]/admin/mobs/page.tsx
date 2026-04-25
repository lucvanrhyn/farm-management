export const dynamic = "force-dynamic";
import MobsManager from "@/components/admin/MobsManager";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmMode } from "@/lib/server/get-farm-mode";
import type { Camp, Mob } from "@/lib/types";


export default async function AdminMobsPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    return (
      <div className="flex min-h-screen bg-[#FAFAF8] items-center justify-center">
        <p className="text-red-500">Farm not found.</p>
      </div>
    );
  }

  const mode = await getFarmMode(farmSlug);

  // Phase I.2: only SSR the membership roster — animals currently assigned to
  // a mob — with a narrow projection. The "add animal to mob" picker is
  // client-side and paginates /api/animals?unassigned=1&search=… on demand.
  // Before this change the page SSR'd every active animal (874 rows / ~120
  // KB JSON on trio-b) into the RSC payload because MobsManager also served
  // as the picker's data source.
  const [prismaMobs, animalGroups, prismaCamps, mobMembers] = await Promise.all([
    prisma.mob.findMany({ orderBy: { name: "asc" } }),
    prisma.animal.groupBy({
      by: ["mobId"],
      where: { status: "Active", mobId: { not: null }, species: mode },
      _count: { _all: true },
    }),
    prisma.camp.findMany({ orderBy: { campName: "asc" } }),
    prisma.animal.findMany({
      where: { status: "Active", species: mode, mobId: { not: null } },
      select: { animalId: true, name: true, mobId: true },
      orderBy: { animalId: "asc" },
    }),
  ]);

  const countByMob: Record<string, number> = {};
  for (const g of animalGroups) {
    if (g.mobId) countByMob[g.mobId] = g._count._all;
  }

  const mobs: Mob[] = prismaMobs.map((m) => ({
    id: m.id,
    name: m.name,
    current_camp: m.currentCamp,
    animal_count: countByMob[m.id] ?? 0,
  }));

  const camps: Camp[] = prismaCamps.map((c) => ({
    camp_id: c.campId,
    camp_name: c.campName,
    size_hectares: c.sizeHectares ?? undefined,
    water_source: c.waterSource ?? undefined,
  }));

  // Narrow membership rows: what MobsManager needs to render "in this mob"
  // lists. Category/currentCamp are intentionally absent — the picker loads
  // them on demand from the paginated API when the admin opens the modal.
  const membership = mobMembers.map((a) => ({
    animalId: a.animalId,
    name: a.name,
    mobId: a.mobId,
  }));

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1C1815]">Mob Management</h1>
        <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
          {mobs.length} mob{mobs.length !== 1 ? "s" : ""} · group and move animals together
        </p>
      </div>
      <MobsManager
        initialMobs={mobs}
        camps={camps}
        membership={membership}
        farmSlug={farmSlug}
      />
    </div>
  );
}
