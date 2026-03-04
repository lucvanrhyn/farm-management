import Link from "next/link";
import { getCampById, getCampStats, getLastInspection, getAnimalsByCamp, getCategoryLabel, getCategoryChipColor } from "@/lib/utils";
import StatusIndicator from "@/components/dashboard/StatusIndicator";

export default async function CampDetailPage({
  params,
}: {
  params: Promise<{ campId: string }>;
}) {
  const { campId } = await params;
  const decodedId = decodeURIComponent(campId);
  const camp = getCampById(decodedId);
  const stats = getCampStats(decodedId);
  const lastLog = getLastInspection(decodedId);
  const animals = getAnimalsByCamp(decodedId);

  const bg = "#0f172a";
  const surface = "#1e293b";
  const border = "#334155";
  const muted = "#94a3b8";

  if (!camp) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: bg }}>
        <p style={{ color: muted }}>Kamp nie gevind: {decodedId}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: bg, color: "#f1f5f9" }}>
      {/* Header */}
      <div className="px-6 py-5 border-b flex items-center gap-4" style={{ borderColor: border, background: surface }}>
        <Link href="/dashboard" className="px-3 py-1.5 rounded-lg text-sm" style={{ background: "#334155", color: muted }}>
          ← Kaart
        </Link>
        <div>
          <h1 className="text-xl font-bold text-white">Kamp {camp.camp_name}</h1>
          <p className="text-xs mt-0.5" style={{ color: muted }}>
            {camp.size_hectares ? `${camp.size_hectares} ha · ` : ""}{camp.water_source}
          </p>
        </div>
      </div>

      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Status */}
        <div className="rounded-2xl p-5" style={{ background: surface, border: `1px solid ${border}` }}>
          <h2 className="text-sm font-semibold text-white mb-4">Huidige Toestand</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            <StatusIndicator type="grazing" status={lastLog?.grazing_quality ?? "Fair"} />
            <StatusIndicator type="water" status={lastLog?.water_status ?? "Full"} />
            <StatusIndicator type="fence" status={lastLog?.fence_status ?? "Intact"} />
          </div>
          <p className="text-xs" style={{ color: muted }}>
            Laaste inspeksie: {lastLog?.date ?? "Onbekend"} · {lastLog?.inspected_by ?? "—"}
          </p>
        </div>

        {/* Animal counts */}
        <div className="rounded-2xl p-5" style={{ background: surface, border: `1px solid ${border}` }}>
          <h2 className="text-sm font-semibold text-white mb-3">Diere: {stats.total}</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.byCategory).map(([cat, count]) => (
              <div key={cat} className="flex items-center gap-1.5">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getCategoryChipColor(cat as Parameters<typeof getCategoryLabel>[0])}`}>
                  {getCategoryLabel(cat as Parameters<typeof getCategoryLabel>[0])}
                </span>
                <span className="text-sm font-bold text-white">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Animal list */}
        <div className="md:col-span-2 rounded-2xl p-5" style={{ background: surface, border: `1px solid ${border}` }}>
          <h2 className="text-sm font-semibold text-white mb-4">Diereli</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {animals.map((a) => (
              <Link
                key={a.animal_id}
                href={`/dashboard/animal/${a.animal_id}`}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm hover:opacity-80 transition-opacity"
                style={{ background: "#334155" }}
              >
                <span className="font-mono font-semibold text-white text-xs">{a.animal_id}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${getCategoryChipColor(a.category)}`}>
                  {getCategoryLabel(a.category)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
