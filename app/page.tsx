import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-6">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-stone-800 mb-2">Brangus Farm</h1>
        <p className="text-stone-500 text-lg">Management System</p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 w-full max-w-3xl">
        <Link href="/logger">
          <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8 flex flex-col items-center gap-4 hover:shadow-md hover:border-green-300 transition-all cursor-pointer">
            <span className="text-5xl">📋</span>
            <div className="text-center">
              <h2 className="text-xl font-semibold text-stone-800">Logger</h2>
              <p className="text-stone-500 text-sm mt-1">Daily field logging</p>
              <p className="text-stone-400 text-xs mt-2">For Dicky</p>
            </div>
          </div>
        </Link>

        <Link href="/dashboard">
          <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8 flex flex-col items-center gap-4 hover:shadow-md hover:border-blue-300 transition-all cursor-pointer">
            <span className="text-5xl">🗺️</span>
            <div className="text-center">
              <h2 className="text-xl font-semibold text-stone-800">Map Hub</h2>
              <p className="text-stone-500 text-sm mt-1">Farm overview & insights</p>
              <p className="text-stone-400 text-xs mt-2">For Management</p>
            </div>
          </div>
        </Link>

        <Link href="/admin">
          <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8 flex flex-col items-center gap-4 hover:shadow-md hover:border-purple-300 transition-all cursor-pointer">
            <span className="text-5xl">⚙️</span>
            <div className="text-center">
              <h2 className="text-xl font-semibold text-stone-800">Admin</h2>
              <p className="text-stone-500 text-sm mt-1">Data & configuration</p>
              <p className="text-stone-400 text-xs mt-2">For Luc</p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
