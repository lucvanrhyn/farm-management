import type { CampCoverReading } from "@prisma/client";
import { calcDaysGrazingRemaining } from "@/lib/server/analytics";

function daysAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

function statusColors(days: number | null): { text: string; bg: string; label: string } {
  if (days === null) return { text: "var(--ft-subtle)", bg: "var(--ft-bg)", label: "No data" };
  if (days <= 3) return { text: "var(--ft-crit)", bg: "var(--ft-crit-bg)", label: "Move soon" };
  if (days <= 7) return { text: "var(--ft-fair)", bg: "var(--ft-fair-bg)", label: "Plan move" };
  return { text: "var(--ft-good)", bg: "var(--ft-good-bg)", label: "Good" };
}

function categoryColor(cat: string): string {
  if (cat === "Good") return "var(--ft-good)";
  if (cat === "Fair") return "var(--ft-fair)";
  return "var(--ft-crit)";
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
        style={{ background: "var(--ft-bg)", borderColor: "var(--ft-border)" }}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-base">🌿</span>
          <p className="text-sm font-semibold" style={{ color: "var(--ft-text)" }}>
            Pasture Intelligence
          </p>
        </div>
        <p className="text-xs mt-1" style={{ color: "var(--ft-subtle)" }}>
          No cover recorded yet. Use the form below to record the first reading.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border p-5"
      style={{ background: statusBg, borderColor: "var(--ft-border)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-base">🌿</span>
          <p className="text-sm font-semibold" style={{ color: "var(--ft-text)" }}>
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
            <span className="text-base font-normal ml-1" style={{ color: "var(--ft-muted)" }}>
              days remaining
            </span>
          </p>
        ) : (
          <p className="text-sm" style={{ color: "var(--ft-subtle)" }}>
            {!sizeHectares
              ? "Add camp size (ha) to calculate days remaining"
              : "No animals in camp"}
          </p>
        )}
      </div>

      {/* Reading details */}
      <div className="mt-3 space-y-1">
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--ft-muted)" }}>
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
        <p className="text-xs" style={{ color: "var(--ft-subtle)" }}>
          By {latest.recordedBy}
          {sizeHectares && animalCount > 0 && (
            <span>
              {" "}
              · {animalCount} head · {sizeHectares} ha ·{" "}
              {Math.round(latest.useFactor * 100)}% use factor
            </span>
          )}
        </p>
      </div>

      {/* Stale reading warning */}
      {readingAge !== null && readingAge > 14 && (
        <p className="mt-3 text-xs" style={{ color: "var(--ft-fair)" }}>
          ⚠ Cover data is {readingAge} days old — record a fresh reading for accuracy
        </p>
      )}
    </div>
  );
}
