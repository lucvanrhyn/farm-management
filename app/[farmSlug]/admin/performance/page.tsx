import { Suspense } from "react";
import PerformanceTable from "@/components/admin/PerformanceTable";
import ExportButton from "@/components/admin/ExportButton";
import DateRangePicker from "@/components/admin/DateRangePicker";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { calcDaysGrazingRemaining } from "@/lib/server/analytics";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ farmSlug: string }>;
  searchParams?: Promise<{ from?: string; to?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  const { farmSlug } = await params;
  const { from, to } = searchParams ? await searchParams : {};
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return <p>Farm not found</p>;

  const fromDate = from ? new Date(from) : undefined;
  const toDate = to ? new Date(to) : undefined;

  const camps = await prisma.camp.findMany({ orderBy: { campId: "asc" } });
  const rows = await Promise.all(
    camps.map(async (camp) => {
      const conditionWhere: Record<string, unknown> = {
        campId: camp.campId,
        type: "camp_condition",
      };
      if (fromDate) conditionWhere.observedAt = { gte: fromDate, ...(toDate && { lte: toDate }) };
      else if (toDate) conditionWhere.observedAt = { lte: toDate };

      const coverWhere: Record<string, unknown> = { campId: camp.campId };
      if (fromDate) coverWhere.recordedAt = { gte: fromDate, ...(toDate && { lte: toDate }) };
      else if (toDate) coverWhere.recordedAt = { lte: toDate };

      const [animalsByCategory, latestCondition, latestCover] = await Promise.all([
        prisma.animal.groupBy({
          by: ["category"],
          where: { currentCamp: camp.campId, status: "Active" },
          _count: { id: true },
        }),
        prisma.observation.findFirst({ where: conditionWhere, orderBy: { observedAt: "desc" } }),
        prisma.campCoverReading.findFirst({ where: coverWhere, orderBy: { recordedAt: "desc" } }),
      ]);

      const animalCount = animalsByCategory.reduce((sum, r) => sum + r._count.id, 0);
      const LSU_FACTOR: Record<string, number> = {
        Cow: 1.0, Bull: 1.2, Heifer: 0.7, Calf: 0.3, Ox: 1.1,
      };
      const totalLSU = animalsByCategory.reduce(
        (sum, r) => sum + r._count.id * (LSU_FACTOR[r.category] ?? 1.0),
        0,
      );
      const density =
        camp.sizeHectares && camp.sizeHectares > 0
          ? (totalLSU / camp.sizeHectares).toFixed(2)
          : null;

      let details: Record<string, string> | null = null;
      if (latestCondition?.details) {
        try {
          details = JSON.parse(latestCondition.details) as Record<string, string>;
        } catch {
          // malformed details — leave as null
        }
      }

      const daysGrazingRemaining =
        latestCover && camp.sizeHectares && camp.sizeHectares > 0
          ? calcDaysGrazingRemaining(
              latestCover.kgDmPerHa,
              latestCover.useFactor,
              camp.sizeHectares,
              animalsByCategory.map((r) => ({ category: r.category, count: r._count.id })),
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
        lastInspection: latestCondition?.observedAt
          ? new Date(latestCondition.observedAt).toISOString().split("T")[0]
          : null,
        coverCategory: latestCover?.coverCategory ?? null,
        daysGrazingRemaining:
          daysGrazingRemaining !== null ? Math.round(daysGrazingRemaining) : null,
      };
    }),
  );

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#1C1815]">Performance</h1>
          <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
            {camps.length} camps · stocking density, grazing, pasture cover
          </p>
        </div>
        <ExportButton farmSlug={farmSlug} exportType="camps" label="Export" />
      </div>
      <div className="mb-4">
        <Suspense fallback={<div className="h-9" />}>
          <DateRangePicker defaultDays={90} />
        </Suspense>
      </div>
      <PerformanceTable rows={rows} farmSlug={farmSlug} />
    </div>
  );
}
