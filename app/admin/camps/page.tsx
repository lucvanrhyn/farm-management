import AdminNav from "@/components/admin/AdminNav";
import AddCampForm from "@/components/admin/AddCampForm";
import CampsTable from "@/components/admin/CampsTable";
import { prisma } from "@/lib/prisma";
import type { Camp } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminCampsPage() {
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
    <div className="flex min-h-screen bg-[#FAFAF8]">
      <AdminNav active="/admin/camps" />
      <main className="flex-1 p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[#1C1815]">Camp Management</h1>
          <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>{camps.length} camps · status and last inspections</p>
        </div>
        <AddCampForm />
        <CampsTable camps={camps} />
      </main>
    </div>
  );
}
