import AdminNav from "@/components/admin/AdminNav";
import AnimalImporter from "@/components/admin/AnimalImporter";

export default function AdminImportPage() {
  return (
    <div className="flex min-h-screen bg-[#FAFAF8]">
      <AdminNav />
      <main className="flex-1 p-8">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold text-[#1C1815] mb-1">Import — Animals</h1>
          <p className="text-sm mb-8" style={{ color: "#9C8E7A" }}>
            Upload an Excel or CSV file to import animals into the system. Existing animals will be updated (based on animal ID).
          </p>
          <AnimalImporter />
        </div>
      </main>
    </div>
  );
}
