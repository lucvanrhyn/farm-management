import AdminNav from "@/components/admin/AdminNav";
import CampsTable from "@/components/admin/CampsTable";
import { CAMPS } from "@/lib/dummy-data";

export const dynamic = "force-dynamic";

export default function AdminCampsPage() {
  return (
    <div className="flex min-h-screen bg-[#FAFAF8]">
      <AdminNav active="/admin/camps" />
      <main className="flex-1 p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[#1C1815]">Camp Management</h1>
          <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>All {CAMPS.length} camps · status and last inspections</p>
        </div>
        <CampsTable />
      </main>
    </div>
  );
}
