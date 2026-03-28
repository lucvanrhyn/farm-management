import PerformanceTable from "@/components/admin/PerformanceTable";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { calcDaysGrazingRemaining } from "@/lib/server/analytics";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PerformancePage({
  params,
}: { params: Promise<{ farmSlug: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  const { farmSlug } = await params;
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return <p>Farm not found</p>;

  const camps = await prisma.camp.findMany({ orderBy: { campId: "asc" } });
  const rows = await Promise.all(camps.map(async (camp) => {
    const [animalsByCategory, latestCondition, latestCover] = await Promise.all([
      prisma.animal.groupBy({
        by: ["category"],
        where: { currentCamp: camp.campId, status: "Active" },
        _count: { id: true },
      }),
      prisma.observation.findFirst({ where: { campId: camp.campId, type: "camp_condition" }, orderBy: { observedAt: "desc" } }),
      prisma.campCoverReading.findFirst({ where: { campId: camp.campId }, orderBy: { recordedAt: "desc" } }),
    ]);

    const animalCount = animalsByCategory.reduce((sum, r) => sum + r._count.id, 0);
    const density = camp.sizeHectares && camp.sizeHectares > 0
      ? (animalCount / camp.sizeHectares).toFixed(1) : null;
    const details = (latestCondition?.details as unknown) as Record<string, string> | null;

    const daysGrazingRemaining =
      latestCover && camp.sizeHectares && camp.sizeHectares > 0
        ? calcDaysGrazingRemaining(
            latestCover.kgDmPerHa,
            latestCover.useFactor,
            camp.sizeHectares,
            animalsByCategory.map((r) => ({ category: r.category, count: r._count.id }))
          )
        : null;

    return {
      campId: camp.campId,
      campName: camp.campName,
      sizeHectares: camp.sizeHectares,
      animalCount,
      stockingDensity: density,
      grazingQuality: details?.grazing ?? null,
      fenceStatus: details?.fence ?? null,
      lastInspection: latestCondition?.observedAt ? new Date(latestCondition.observedAt).toISOString().split("T")[0] : null,
      coverCategory: latestCover?.coverCategory ?? null,
      daysGrazingRemaining: daysGrazingRemaining !== null ? Math.round(daysGrazingRemaining) : null,
    };
  }));

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-[#1C1815]">Performance</h1>
          <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
            {camps.length} camps · stocking density, grazing, pasture cover
          </p>
        </div>
        <PerformanceTable rows={rows} farmSlug={farmSlug} />
    </div>
  );
}
