import AnimalImporter from "@/components/admin/AnimalImporter";
import { PageHeader } from "@/components/ds";
import AdminPage from "@/app/_components/AdminPage";

export default function AdminImportPage() {
  return (
    <AdminPage>
      <div className="max-w-2xl">
        <PageHeader
          className="px-0 py-0 mb-2"
          title="Import Animals"
          subtitle="data import · upload the two-tab Excel template to import camps and animals in one step"
        />
        <ol className="text-sm mb-8 space-y-1 list-decimal list-inside" style={{ color: "var(--ft-muted)" }}>
          <li>Download the template below</li>
          <li>Fill in the <strong>Camps</strong> tab — each camp you want to create</li>
          <li>Fill in the <strong>Animals</strong> tab — use the same camp names in the <code className="text-xs px-1 py-0.5 rounded" style={{ background: "rgba(122,92,30,0.1)", color: "var(--ft-fair)" }}>current_camp</code> column</li>
          <li>Upload the file — camps are created first, then animals are linked</li>
        </ol>
        <AnimalImporter />
      </div>
    </AdminPage>
  );
}
