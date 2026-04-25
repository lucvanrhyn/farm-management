import { getLatestCampConditions } from "@/lib/server/camp-status";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import type { Camp } from "@/lib/types";
import CampsTableClient, { type CampRow } from "./CampsTableClient";

export default async function CampsTable({ camps, farmSlug }: { camps: Camp[]; farmSlug: string }) {
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return <p className="text-sm text-red-500">Farm not found.</p>;

  const [liveConditions, animalGroups, rotationCamps] = await Promise.all([
    getLatestCampConditions(prisma),
    // cross-species by design: camps overview totals every species per camp.
    prisma.animal.groupBy({
      by: ["currentCamp"],
      where: { currentCamp: { in: camps.map((c) => c.camp_id) }, status: "Active" },
      _count: { _all: true },
    }),
    prisma.camp.findMany({
      select: {
        campId: true,
        veldType: true,
        restDaysOverride: true,
        maxGrazingDaysOverride: true,
        rotationNotes: true,
      },
    }),
  ]);

  const countByCamp = new Map(animalGroups.map((g) => [g.currentCamp, g._count._all]));
  const rotationByCamp = new Map(rotationCamps.map((c) => [c.campId, c]));

  const rows: CampRow[] = camps.map((camp) => {
    const live = liveConditions.get(camp.camp_id);
    const rot = rotationByCamp.get(camp.camp_id);
    return {
      camp_id: camp.camp_id,
      camp_name: camp.camp_name,
      water_source: camp.water_source,
      sizeHectares: camp.size_hectares,
      color: camp.color,
      liveCount: countByCamp.get(camp.camp_id) ?? 0,
      grazing: live?.grazing_quality ?? "Fair",
      fence: live?.fence_status ?? "Intact",
      lastDate: live ? live.last_inspected_at.split("T")[0] : "—",
      lastBy: live?.last_inspected_by ?? "—",
      veldType: rot?.veldType ?? null,
      restDaysOverride: rot?.restDaysOverride ?? null,
      maxGrazingDaysOverride: rot?.maxGrazingDaysOverride ?? null,
      rotationNotes: rot?.rotationNotes ?? null,
    };
  });

  return <CampsTableClient rows={rows} farmSlug={farmSlug} />;
}
