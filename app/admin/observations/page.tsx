import AdminNav from "@/components/admin/AdminNav";
import ObservationsLog from "@/components/admin/ObservationsLog";
import ClearSectionButton from "@/components/admin/ClearSectionButton";

export const dynamic = "force-dynamic";

export default function AdminObservationsPage() {
  return (
    <div className="flex min-h-screen bg-stone-50">
      <AdminNav active="/admin/observations" />
      <main className="flex-1 p-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-stone-800">Observations</h1>
            <p className="text-stone-500 text-sm mt-1">All field observations — search, filter and edit</p>
          </div>
          <ClearSectionButton endpoint="/api/observations/reset" label="Clear All Observations" />
        </div>
        <ObservationsLog />
      </main>
    </div>
  );
}
