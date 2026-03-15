import AdminNav from "@/components/admin/AdminNav";
import AnimalImporter from "@/components/admin/AnimalImporter";

export default function AdminImportPage() {
  return (
    <div className="flex min-h-screen bg-stone-50">
      <AdminNav active="/admin/import" />
      <main className="flex-1 p-8">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold text-stone-800 mb-1">Invoer — Diere</h1>
          <p className="text-stone-500 text-sm mb-8">
            Laai 'n Excel- of CSV-lêer op om diere in die stelsel in te voer. Bestaande diere word opgedateer (op grond van diere-ID).
          </p>
          <AnimalImporter />
        </div>
      </main>
    </div>
  );
}
