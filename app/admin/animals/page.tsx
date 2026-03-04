import AdminNav from "@/components/admin/AdminNav";
import AnimalsTable from "@/components/admin/AnimalsTable";

export default function AdminAnimalsPage() {
  return (
    <div className="flex min-h-screen bg-stone-50">
      <AdminNav active="/admin/animals" />
      <main className="flex-1 p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-stone-800">Dierekatalogus</h1>
          <p className="text-stone-500 text-sm mt-1">Alle aktiewe diere op die plaas</p>
        </div>
        <AnimalsTable />
      </main>
    </div>
  );
}
