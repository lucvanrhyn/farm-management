import { Suspense } from "react";
import AddCampForm from "@/components/admin/AddCampForm";
import CampsTable from "@/components/admin/CampsTable";
import CampAnalyticsSection from "@/components/admin/CampAnalyticsSection";
import PerformanceSection from "@/components/admin/PerformanceSection";
import CampsTabBar from "@/components/admin/CampsTabBar";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import type { Camp } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminCampsPage({
  params,
  searchParams,
}: {
  params: Promise<{ farmSlug: string }>;
  searchParams?: Promise<{ tab?: string; from?: string; to?: string }>;
}) {
  const { farmSlug } = await params;
  const sp = await searchParams;
  const activeTab = sp?.tab ?? "camps";
  const from = sp?.from;
  const to = sp?.to;

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    return (
      <div className="flex min-h-screen bg-[#FAFAF8] items-center justify-center">
        <p className="text-red-500">Farm not found.</p>
      </div>
    );
  }

  const prismaCamps = await prisma.camp.findMany({ orderBy: { campName: "asc" } });
  const camps: Camp[] = prismaCamps.map((c) => ({
    camp_id: c.campId,
    camp_name: c.campName,
    size_hectares: c.sizeHectares ?? undefined,
    water_source: c.waterSource ?? undefined,
    geojson: c.geojson ?? undefined,
    notes: c.notes ?? undefined,
  }));

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1C1815]">Camps</h1>
        <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
          {camps.length} camps · management and performance
        </p>
      </div>

      <CampsTabBar activeTab={activeTab} farmSlug={farmSlug} />

      {activeTab === "camps" && (
        <>
          <AddCampForm />
          <CampsTable camps={camps} farmSlug={farmSlug} />
          <Suspense fallback={<div className="mt-8 h-48 rounded-xl animate-pulse" style={{ background: "#F5F2EE" }} />}>
            <CampAnalyticsSection farmSlug={farmSlug} />
          </Suspense>
        </>
      )}

      {activeTab === "performance" && (
        <Suspense fallback={<div className="mt-4 h-64 rounded-xl animate-pulse" style={{ background: "#F5F2EE" }} />}>
          <PerformanceSection farmSlug={farmSlug} from={from} to={to} />
        </Suspense>
      )}
    </div>
  );
}
