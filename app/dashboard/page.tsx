import DashboardClient from "@/components/dashboard/DashboardClient";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [totalAnimals, animalGroups] = await Promise.all([
    prisma.animal.count({ where: { status: "Active" } }),
    prisma.animal.groupBy({
      by: ["currentCamp"],
      where: { status: "Active" },
      _count: { _all: true },
    }),
  ]);

  const campAnimalCounts: Record<string, number> = {};
  for (const g of animalGroups) {
    campAnimalCounts[g.currentCamp] = g._count._all;
  }

  return <DashboardClient totalAnimals={totalAnimals} campAnimalCounts={campAnimalCounts} />;
}
