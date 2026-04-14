import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmMode } from "@/lib/server/get-farm-mode";
import { getFarmCreds } from "@/lib/meta-db";
import ClearSectionButton from "@/components/admin/ClearSectionButton";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import ObservationsPageClient from "./ObservationsPageClient";

export const dynamic = "force-dynamic";

export default async function AdminObservationsPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  const creds = await getFarmCreds(farmSlug);
  if (creds?.tier === "basic") {
    return <UpgradePrompt feature="Observations Trail" farmSlug={farmSlug} />;
  }

  const prisma = await getPrismaForFarm(farmSlug);

  if (!prisma) {
    return (
      <div className="flex-1 min-w-0 p-4 md:p-8">
        <p className="text-red-500">Farm not found.</p>
      </div>
    );
  }

  const mode = await getFarmMode(farmSlug);

  const [prismaCamps, prismaAnimals] = await Promise.all([
    prisma.camp.findMany({ orderBy: { campName: "asc" }, select: { campId: true, campName: true } }),
    prisma.animal.findMany({ where: { status: "Active", species: mode }, orderBy: { animalId: "asc" }, select: { animalId: true, currentCamp: true } }),
  ]);

  const camps = prismaCamps.map((c) => ({ id: c.campId, name: c.campName }));
  const animals = prismaAnimals.map((a) => ({ id: a.animalId, tag: a.animalId, campId: a.currentCamp }));

  return (
    <div className="flex-1 min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1C1815]">Observations</h1>
          <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>All field observations — search, filter and edit</p>
        </div>
        <ClearSectionButton endpoint="/api/observations/reset" label="Clear All Observations" />
      </div>
      <ObservationsPageClient camps={camps} animals={animals} />
    </div>
  );
}
