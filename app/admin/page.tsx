import Link from "next/link";

export default function AdminPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-stone-700 mb-4">Admin Dashboard</h1>
      <nav className="flex flex-col gap-2 text-sm">
        <Link href="/admin/animals" className="text-purple-600 hover:underline">Manage Animals</Link>
        <Link href="/admin/camps" className="text-purple-600 hover:underline">Manage Camps</Link>
        <Link href="/admin/import" className="text-purple-600 hover:underline">Import Data</Link>
      </nav>
    </div>
  );
}
