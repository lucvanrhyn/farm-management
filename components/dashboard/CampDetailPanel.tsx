"use client";

import StatusIndicator from "./StatusIndicator";
import { getCampById, getCampStats, getLastInspection, getLast7DaysLogs, getAnimalsByCamp, getCategoryLabel, getCategoryPluralLabel, getCategoryChipColor } from "@/lib/utils";
import type { AnimalCategory } from "@/lib/types";

interface Props {
  campId: string;
  onClose: () => void;
  onSelectAnimal: (animalId: string) => void;
}

const CATEGORY_ORDER: AnimalCategory[] = ["Cow", "Heifer", "Calf", "Bull", "Ox"];

function Sparkline({ campId }: { campId: string }) {
  const logs = getLast7DaysLogs(campId);
  if (logs.length < 2) return null;

  const counts = logs.map((l) => l.animal_count ?? 0);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const range = max - min || 1;

  const W = 100;
  const H = 32;
  const points = counts.map((c, i) => {
    const x = (i / (counts.length - 1)) * W;
    const y = H - ((c - min) / range) * (H - 4) - 2;
    return `${x},${y}`;
  });

  const lastPoint = points[points.length - 1].split(",");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 32 }}>
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="#8B6914"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastPoint[0]} cy={lastPoint[1]} r="2.5" fill="#C4A030" />
    </svg>
  );
}

// Warm palette tokens for the panel
const P = {
  bg:      "#1E1710",
  surface: "#261C12",
  border:  "rgba(140,100,60,0.22)",
  cream:   "#F5EBD4",
  tan:     "#B09878",
  dim:     "rgba(176,152,120,0.5)",
  hover:   "rgba(140,100,60,0.08)",
};

// Category chip colors — warm tones
const WARM_CHIP: Record<string, string> = {
  Cow:    "rgba(74,124,89,0.18)",
  Calf:   "rgba(59,122,139,0.18)",
  Heifer: "rgba(101,80,160,0.18)",
  Bull:   "rgba(139,105,20,0.18)",
  Ox:     "rgba(92,61,46,0.18)",
};
const WARM_CHIP_TEXT: Record<string, string> = {
  Cow:    "#6FAB80",
  Calf:   "#5AAFCA",
  Heifer: "#9B80D0",
  Bull:   "#C4A030",
  Ox:     "#B09878",
};

export default function CampDetailPanel({ campId, onClose, onSelectAnimal }: Props) {
  const camp = getCampById(campId);
  const stats = getCampStats(campId);
  const lastLog = getLastInspection(campId);
  const animals = getAnimalsByCamp(campId);

  if (!camp) return null;

  return (
    <div className="flex flex-col h-full" style={{ background: P.bg }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 border-b"
        style={{ borderColor: P.border }}
      >
        <div>
          <h2
            style={{
              fontFamily: "var(--font-dm-serif)",
              fontSize: 18,
              color: P.cream,
              lineHeight: 1.2,
            }}
          >
            Kamp {camp.camp_name}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: P.tan }}>
            {camp.size_hectares ? `${camp.size_hectares} ha · ` : ""}{camp.water_source}
          </p>
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-full text-xl"
          style={{ background: P.surface, color: P.tan, border: `1px solid ${P.border}` }}
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Status indicators */}
        <div
          className="px-5 py-4 flex flex-wrap gap-2 border-b"
          style={{ borderColor: P.border }}
        >
          <StatusIndicator type="grazing" status={lastLog?.grazing_quality ?? "Fair"} />
          <StatusIndicator type="water"   status={lastLog?.water_status ?? "Full"} />
          <StatusIndicator type="fence"   status={lastLog?.fence_status ?? "Intact"} />
        </div>

        {/* Animal count breakdown */}
        <div className="px-5 py-4 border-b" style={{ borderColor: P.border }}>
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-sm font-semibold" style={{ color: P.tan }}>Diere</p>
            <span
              style={{
                fontFamily: "var(--font-dm-serif)",
                fontSize: 28,
                color: P.cream,
                lineHeight: 1,
              }}
            >
              {stats.total}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {CATEGORY_ORDER.filter((cat) => (stats.byCategory[cat] ?? 0) > 0).map((cat) => (
              <div key={cat} className="flex items-center justify-between">
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 20,
                    fontWeight: 500,
                    fontFamily: "var(--font-sans)",
                    background: WARM_CHIP[cat] ?? "rgba(92,61,46,0.18)",
                    color: WARM_CHIP_TEXT[cat] ?? "#B09878",
                  }}
                >
                  {getCategoryPluralLabel(cat)}
                </span>
                <span className="text-sm font-semibold" style={{ color: P.cream }}>
                  {stats.byCategory[cat]}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Last inspection + sparkline */}
        <div className="px-5 py-4 border-b" style={{ borderColor: P.border }}>
          <p className="text-xs font-semibold mb-2" style={{ color: P.dim }}>
            Laaste inspeksie
          </p>
          <p className="text-sm mb-3" style={{ color: P.cream }}>
            {lastLog?.date ?? "Onbekend"} · {lastLog?.inspected_by ?? "—"}
          </p>
          <p className="text-xs font-semibold mb-1" style={{ color: P.dim }}>
            Diere (laaste 7 dae)
          </p>
          <Sparkline campId={campId} />
        </div>

        {/* Animal list */}
        <div className="px-5 pt-4">
          <p className="text-xs font-semibold mb-3" style={{ color: P.dim }}>
            Dierelys ({animals.length})
          </p>
          <div className="flex flex-col gap-0.5">
            {animals.slice(0, 30).map((animal) => (
              <button
                key={animal.animal_id}
                onClick={() => onSelectAnimal(animal.animal_id)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-left w-full"
                style={{ background: "transparent", transition: "background 0.12s" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = P.hover)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span
                  className="font-mono text-xs font-semibold"
                  style={{ color: P.cream }}
                >
                  {animal.animal_id}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    padding: "1px 6px",
                    borderRadius: 20,
                    fontFamily: "var(--font-sans)",
                    background: WARM_CHIP[animal.category] ?? "rgba(92,61,46,0.18)",
                    color: WARM_CHIP_TEXT[animal.category] ?? "#B09878",
                  }}
                >
                  {getCategoryLabel(animal.category)}
                </span>
              </button>
            ))}
            {animals.length > 30 && (
              <p className="text-xs text-center py-2" style={{ color: P.dim }}>
                + {animals.length - 30} meer diere
              </p>
            )}
          </div>
        </div>
        <div className="h-6" />
      </div>
    </div>
  );
}
