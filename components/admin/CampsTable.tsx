import { getLatestCampConditions } from "@/lib/server/camp-status";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import type { Camp } from "@/lib/types";
import CampsTableClient, { type CampRow } from "./CampsTableClient";

export default async function CampsTable({ camps, farmSlug }: { camps: Camp[]; farmSlug: string }) {
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return <p className="text-sm text-red-500">Farm not found.</p>;

  const liveConditions = await getLatestCampConditions(prisma);

  const animalCounts = await Promise.all(
    camps.map((camp) =>
      prisma.animal.count({ where: { currentCamp: camp.camp_id, status: "Active" } })
    )
  );
  const countByCamp = new Map(camps.map((camp, i) => [camp.camp_id, animalCounts[i]]));

  const rows: CampRow[] = camps.map((camp) => {
    const live = liveConditions.get(camp.camp_id);
    return {
      camp_id: camp.camp_id,
      camp_name: camp.camp_name,
      water_source: camp.water_source,
      liveCount: countByCamp.get(camp.camp_id) ?? 0,
      grazing: live?.grazing_quality ?? "Fair",
      fence: live?.fence_status ?? "Intact",
      lastDate: live ? live.last_inspected_at.split("T")[0] : "—",
      lastBy: live?.last_inspected_by ?? "—",
    };
  });

  return <CampsTableClient rows={rows} />;
}
