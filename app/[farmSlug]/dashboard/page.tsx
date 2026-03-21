import DashboardClient from "@/components/dashboard/DashboardClient";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import type { Camp } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return <p className="p-8 text-red-500">Farm not found.</p>;

  const [totalAnimals, animalGroups, prismaCamps] = await Promise.all([
    prisma.animal.count({ where: { status: "Active" } }),
    prisma.animal.groupBy({
      by: ["currentCamp"],
      where: { status: "Active" },
      _count: { _all: true },
    }),
    prisma.camp.findMany({ orderBy: { campName: "asc" } }),
  ]);

  const campAnimalCounts: Record<string, number> = {};
  for (const g of animalGroups) {
    campAnimalCounts[g.currentCamp] = g._count._all;
  }

  const camps: Camp[] = prismaCamps.map((c) => ({
    camp_id: c.campId,
    camp_name: c.campName,
    size_hectares: c.sizeHectares ?? undefined,
    water_source: c.waterSource ?? undefined,
  }));

  return <DashboardClient totalAnimals={totalAnimals} campAnimalCounts={campAnimalCounts} camps={camps} />;
}
