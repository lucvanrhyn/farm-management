import AnimalImporter from "@/components/admin/AnimalImporter";
import AdminPage from "@/app/_components/AdminPage";

export default function AdminImportPage() {
  return (
    <AdminPage>
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-[var(--ft-text)] mb-1">Import Animals</h1>
        <p className="text-sm mb-2" style={{ color: "var(--ft-subtle)" }}>
          Upload the two-tab Excel template to import camps and animals in one step.
        </p>
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
