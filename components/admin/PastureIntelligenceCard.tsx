import type { CampCoverReading } from "@prisma/client";
import { calcDaysGrazingRemaining } from "@/lib/server/analytics";

function daysAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

function statusColors(days: number | null): { text: string; bg: string; label: string } {
  if (days === null) return { text: "#9C8E7A", bg: "#F7F4F0", label: "No data" };
  if (days <= 3) return { text: "#B91C1C", bg: "#FFF5F5", label: "Move soon" };
  if (days <= 7) return { text: "#B45309", bg: "#FFFBEB", label: "Plan move" };
  return { text: "#2A7D4F", bg: "#F0FBF5", label: "Good" };
}

function categoryColor(cat: string): string {
  if (cat === "Good") return "#2A7D4F";
  if (cat === "Fair") return "#B45309";
  return "#B91C1C";
}

interface Props {
  latest: CampCoverReading | null;
  sizeHectares: number | null;
  animalCount: number;
  animalsByCategory?: Array<{ category: string; count: number }>;
}

export default function PastureIntelligenceCard({ latest, sizeHectares, animalCount, animalsByCategory }: Props) {
  const daysRemaining =
    latest && sizeHectares
      ? animalsByCategory
        ? calcDaysGrazingRemaining(latest.kgDmPerHa, latest.useFactor, sizeHectares, animalsByCategory)
        : animalCount > 0
          ? Math.round((latest.kgDmPerHa * sizeHectares * latest.useFactor) / (animalCount * 10))
          : null
      : null;

  const { text: statusText, bg: statusBg, label: statusLabel } = statusColors(daysRemaining);
  const readingAge = latest ? daysAgo(latest.recordedAt) : null;

  if (!latest) {
    return (
      <div
        className="rounded-2xl border p-5"
        style={{ background: "#FAFAF8", borderColor: "#E0D5C8" }}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-base">🌿</span>
          <p className="text-sm font-semibold" style={{ color: "#1C1815" }}>
            Pasture Intelligence
          </p>
        </div>
        <p className="text-xs mt-1" style={{ color: "#9C8E7A" }}>
          No cover recorded yet. Use the form below to record the first reading.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border p-5"
      style={{ background: statusBg, borderColor: "#E0D5C8" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-base">🌿</span>
          <p className="text-sm font-semibold" style={{ color: "#1C1815" }}>
            Pasture Intelligence
          </p>
        </div>
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ background: statusText + "22", color: statusText }}
        >
          {statusLabel}
        </span>
      </div>

      {/* Days remaining — big number */}
      <div className="mt-3">
        {daysRemaining !== null ? (
          <p className="text-3xl font-bold tabular-nums" style={{ color: statusText }}>
            {daysRemaining}
            <span className="text-base font-normal ml-1" style={{ color: "#6B5E50" }}>
              days remaining
            </span>
          </p>
        ) : (
          <p className="text-sm" style={{ color: "#9C8E7A" }}>
            {!sizeHectares
              ? "Add camp size (ha) to calculate days remaining"
              : "No animals in camp"}
          </p>
        )}
      </div>

      {/* Reading details */}
      <div className="mt-3 space-y-1">
        <div className="flex items-center gap-2 text-xs" style={{ color: "#6B5E50" }}>
          <span
            className="font-semibold"
            style={{ color: categoryColor(latest.coverCategory) }}
          >
            {latest.coverCategory}
          </span>
          <span>·</span>
          <span className="font-mono">{latest.kgDmPerHa.toLocaleString()} kg DM/ha</span>
          <span>·</span>
          <span>
            {readingAge === 0
              ? "Recorded today"
              : readingAge === 1
              ? "1 day ago"
              : `${readingAge} days ago`}
          </span>
        </div>
        <p className="text-xs" style={{ color: "#9C8E7A" }}>
          By {latest.recordedBy}
          {sizeHectares && animalCount > 0 && (
            <span>
              {" "}
              · {animalCount} head · {sizeHectares} ha ·{" "}
              {Math.round(latest.useFactor * 100)}% use factor
            </span>
          )}
        </p>
        {latest.notes && (
          <p className="text-xs italic" style={{ color: "#9C8E7A" }}>
            "{latest.notes}"
          </p>
        )}
      </div>

      {/* Stale reading warning */}
      {readingAge !== null && readingAge > 14 && (
        <p className="mt-3 text-xs" style={{ color: "#B45309" }}>
          ⚠ Cover data is {readingAge} days old — record a fresh reading for accuracy
        </p>
      )}
    </div>
  );
}
