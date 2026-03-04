import AdminNav from "@/components/admin/AdminNav";
import CampsTable from "@/components/admin/CampsTable";

export default function AdminCampsPage() {
  return (
    <div className="flex min-h-screen bg-stone-50">
      <AdminNav active="/admin/camps" />
      <main className="flex-1 p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-stone-800">Kampbestuur</h1>
          <p className="text-stone-500 text-sm mt-1">Alle 19 kampe · status en laaste inspeksies</p>
        </div>
        <CampsTable />
      </main>
    </div>
  );
}
