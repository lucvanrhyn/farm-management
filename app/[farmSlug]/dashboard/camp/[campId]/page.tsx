import Link from "next/link";
import { getCategoryLabel, getCategoryChipColor } from "@/lib/utils";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getLatestCampConditions } from "@/lib/server/camp-status";
import { getFarmMode } from "@/lib/server/get-farm-mode";
import StatusIndicator from "@/components/dashboard/StatusIndicator";
import type { AnimalCategory } from "@/lib/types";


export default async function CampDetailPage({
  params,
}: {
  params: Promise<{ farmSlug: string; campId: string }>;
}) {
  const { farmSlug, campId } = await params;
  const decodedId = decodeURIComponent(campId);
  const dashboardRoot = `/${farmSlug}/dashboard`;

  const prisma = await getPrismaForFarm(farmSlug);
  const bg = "#0f172a";
  const surface = "#1e293b";
  const border = "#334155";
  const muted = "#94a3b8";

  if (!prisma) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: bg }}>
        <p style={{ color: muted }}>Farm not found.</p>
      </div>
    );
  }

  const mode = await getFarmMode(farmSlug);

  const [camp, animals, liveConditions] = await Promise.all([
    prisma.camp.findFirst({ where: { campId: decodedId } }),
    prisma.animal.findMany({
      where: { currentCamp: decodedId, status: "Active", species: mode },
      orderBy: [{ category: "asc" }, { animalId: "asc" }],
      select: { animalId: true, category: true },
    }),
    getLatestCampConditions(prisma),
  ]);
  const liveCondition = liveConditions.get(decodedId);

  // Compute stats from real animals
  const byCategory = animals.reduce<Partial<Record<AnimalCategory, number>>>((acc, a) => {
    const cat = a.category as AnimalCategory;
    acc[cat] = (acc[cat] ?? 0) + 1;
    return acc;
  }, {});

  if (!camp) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: bg }}>
        <p style={{ color: muted }}>Camp not found: {decodedId}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto" style={{ background: bg, color: "#f1f5f9" }}>
      {/* Header */}
      <div className="px-6 py-5 border-b flex items-center gap-4" style={{ borderColor: border, background: surface }}>
        <Link href={dashboardRoot} className="px-3 py-1.5 rounded-lg text-sm" style={{ background: "#334155", color: muted }}>
          ← Map
        </Link>
        <div>
          <h1 className="text-xl font-bold text-white">Camp {camp.campName}</h1>
          <p className="text-xs mt-0.5" style={{ color: muted }}>
            {camp.sizeHectares ? `${camp.sizeHectares} ha · ` : ""}{camp.waterSource}
          </p>
        </div>
      </div>

      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Status */}
        <div className="rounded-2xl p-5" style={{ background: surface, border: `1px solid ${border}` }}>
          <h2 className="text-sm font-semibold text-white mb-4">Current Condition</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            <StatusIndicator type="grazing" status={liveCondition?.grazing_quality ?? "Fair"} />
            <StatusIndicator type="water" status={liveCondition?.water_status ?? "Full"} />
            <StatusIndicator type="fence" status={liveCondition?.fence_status ?? "Intact"} />
          </div>
          <p className="text-xs" style={{ color: muted }}>
            Last inspection: {liveCondition?.last_inspected_at?.split("T")[0] ?? "Unknown"} · {liveCondition?.last_inspected_by ?? "—"}
          </p>
        </div>

        {/* Animal counts */}
        <div className="rounded-2xl p-5" style={{ background: surface, border: `1px solid ${border}` }}>
          <h2 className="text-sm font-semibold text-white mb-3">Animals: {animals.length}</h2>
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
          <h2 className="text-sm font-semibold text-white mb-4">Animal List</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {animals.map((a) => (
              <Link
                key={a.animalId}
                href={`/${farmSlug}/dashboard/animal/${a.animalId}`}
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
