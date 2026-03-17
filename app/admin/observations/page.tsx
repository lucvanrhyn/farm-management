import AdminNav from "@/components/admin/AdminNav";
import ObservationsLog from "@/components/admin/ObservationsLog";

export const dynamic = "force-dynamic";

export default function AdminObservationsPage() {
  return (
    <div className="flex min-h-screen bg-stone-50">
      <AdminNav active="/admin/observations" />
      <main className="flex-1 p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-stone-800">Observations</h1>
          <p className="text-stone-500 text-sm mt-1">All field observations — search, filter and edit</p>
        </div>
        <ObservationsLog />
      </main>
    </div>
  );
}
