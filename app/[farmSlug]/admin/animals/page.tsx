import { Suspense } from "react";
import AnimalsTable from "@/components/admin/AnimalsTable";
import ClearSectionButton from "@/components/admin/ClearSectionButton";
import RecordBirthButton from "@/components/admin/RecordBirthButton";
import ExportButton from "@/components/admin/ExportButton";
import AnimalAnalyticsSection from "@/components/admin/AnimalAnalyticsSection";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getAnimalsInWithdrawal } from "@/lib/server/treatment-analytics";
import { getFarmMode } from "@/lib/server/get-farm-mode";
import type { Camp, Mob, PrismaAnimal } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminAnimalsPage({
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

  const [animals, prismaCamps, withdrawalAnimals, prismaMobs] = await Promise.all([
    prisma.animal.findMany({ where: { species: mode }, orderBy: [{ category: "asc" }, { animalId: "asc" }] }),
    prisma.camp.findMany({ orderBy: { campName: "asc" } }),
    getAnimalsInWithdrawal(prisma),
    prisma.mob.findMany({ orderBy: { name: "asc" } }),
  ]);

  const withdrawalIds = new Set(withdrawalAnimals.map((w) => w.animalId));

  const camps: Camp[] = prismaCamps.map((c) => ({
    camp_id: c.campId,
    camp_name: c.campName,
    size_hectares: c.sizeHectares ?? undefined,
    water_source: c.waterSource ?? undefined,
  }));

  const mobs: Mob[] = prismaMobs.map((m) => ({
    id: m.id,
    name: m.name,
    current_camp: m.currentCamp,
  }));

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1C1815]">Animal Catalogue</h1>
          <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
            {animals.filter((a) => a.status !== "Deceased").length.toLocaleString()} active · {animals.filter((a) => a.status === "Deceased").length.toLocaleString()} deceased
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <ExportButton farmSlug={farmSlug} exportType="animals" />
          <RecordBirthButton animals={animals as unknown as PrismaAnimal[]} camps={camps} />
          <ClearSectionButton endpoint="/api/animals/reset" label="Clear All Animals" />
        </div>
      </div>
      <AnimalsTable animals={animals as unknown as PrismaAnimal[]} camps={camps} farmSlug={farmSlug} withdrawalIds={withdrawalIds} mobs={mobs} />
      <Suspense fallback={<div className="mt-8 h-48 rounded-xl animate-pulse" style={{ background: "#F5F2EE" }} />}>
        <AnimalAnalyticsSection farmSlug={farmSlug} />
      </Suspense>
    </div>
  );
}
