import Link from "next/link";
import { getCampById, getLastInspection, getCategoryLabel, getCategoryChipColor } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import StatusIndicator from "@/components/dashboard/StatusIndicator";
import type { AnimalCategory } from "@/lib/types";

export default async function CampDetailPage({
  params,
}: {
  params: Promise<{ campId: string }>;
}) {
  const { campId } = await params;
  const decodedId = decodeURIComponent(campId);
  const camp = getCampById(decodedId);
  const lastLog = getLastInspection(decodedId);
  const animals = await prisma.animal.findMany({
    where: { currentCamp: decodedId, status: "Active" },
    orderBy: [{ category: "asc" }, { animalId: "asc" }],
    select: { animalId: true, category: true },
  });

  // Compute stats from real animals
  const byCategory = animals.reduce<Partial<Record<AnimalCategory, number>>>((acc, a) => {
    const cat = a.category as AnimalCategory;
    acc[cat] = (acc[cat] ?? 0) + 1;
    return acc;
  }, {});

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
    <div className="h-full overflow-y-auto" style={{ background: bg, color: "#f1f5f9" }}>
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
          <h2 className="text-sm font-semibold text-white mb-3">Diere: {animals.length}</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(byCategory).map(([cat, count]) => (
              <div key={cat} className="flex items-center gap-1.5">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getCategoryChipColor(cat as AnimalCategory)}`}>
                  {getCategoryLabel(cat as AnimalCategory)}
                </span>
                <span className="text-sm font-bold text-white">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Animal list */}
        <div className="md:col-span-2 rounded-2xl p-5" style={{ background: surface, border: `1px solid ${border}` }}>
          <h2 className="text-sm font-semibold text-white mb-4">Dierelys</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {animals.map((a) => (
              <Link
                key={a.animalId}
                href={`/dashboard/animal/${a.animalId}`}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm hover:opacity-80 transition-opacity"
                style={{ background: "#334155" }}
              >
                <span className="font-mono font-semibold text-white text-xs">{a.animalId}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${getCategoryChipColor(a.category as AnimalCategory)}`}>
                  {getCategoryLabel(a.category as AnimalCategory)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
