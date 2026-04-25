export const dynamic = "force-dynamic";
import Link from "next/link";
import {
  AlertTriangle,
  AlertOctagon,
  ClipboardX,
  Droplets,
  FileWarning,
} from "lucide-react";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmCreds } from "@/lib/meta-db";
import { gameModule } from "@/lib/species/game/index";
import {
  getLatestCensusData,
  getSpeciesWithOverdueCensus,
} from "@/lib/species/game/analytics";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import SpeciesPopulationTable from "@/components/game/SpeciesPopulationTable";
import OverdueCensusTable from "@/components/game/OverdueCensusTable";
import type { SpeciesAlert } from "@/lib/species/types";


// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function censusFreshness(dateStr: string | null): "good" | "warning" | "alert" | "neutral" {
  if (!dateStr) return "neutral";
  const days = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days <= 90)  return "good";
  if (days <= 180) return "warning";
  return "alert";
}

const STATUS_COLORS = {
  good:    { color: "#166534", bg: "rgba(34,197,94,0.1)" },
  warning: { color: "#92400E", bg: "rgba(245,158,11,0.12)" },
  alert:   { color: "#991B1B", bg: "rgba(220,38,38,0.1)" },
  neutral: { color: "#9C8E7A", bg: "rgba(156,142,122,0.1)" },
};

const ALERT_ICONS: Record<string, React.ElementType> = {
  FileWarning,
  AlertTriangle,
  ClipboardX,
  AlertOctagon,
  Droplets,
};

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  status,
}: {
  label: string;
  value: string | number;
  sub: string;
  status: "good" | "warning" | "alert" | "neutral";
}) {
  const { color, bg } = STATUS_COLORS[status];
  return (
    <div
      className="rounded-2xl border p-5 flex flex-col gap-1"
      style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
        {label}
      </p>
      <p className="text-3xl font-bold tabular-nums" style={{ color }}>
        {value}
      </p>
      <span
        className="self-start text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ background: bg, color }}
      >
        {sub}
      </span>
    </div>
  );
}

// ── Alert Card ────────────────────────────────────────────────────────────────

function AlertCard({ alert }: { alert: SpeciesAlert }) {
  const Icon = ALERT_ICONS[alert.icon] ?? AlertTriangle;
  const isRed = alert.severity === "red";
  const style = isRed
    ? { background: "rgba(220,38,38,0.06)", borderColor: "rgba(220,38,38,0.25)", color: "#991B1B" }
    : { background: "rgba(245,158,11,0.06)", borderColor: "rgba(245,158,11,0.3)", color: "#92400E" };

  return (
    <Link
      href={alert.href}
      prefetch={false}
      className="flex items-start gap-3 rounded-xl border px-4 py-3 transition-opacity hover:opacity-80"
      style={style}
    >
      <Icon className="w-4 h-4 mt-0.5 shrink-0" />
      <p className="text-sm font-medium leading-snug">{alert.message}</p>
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function GameCensusPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  const creds = await getFarmCreds(farmSlug);
  if (creds?.tier === "basic") {
    return <UpgradePrompt feature="Game Management" farmSlug={farmSlug} />;
  }

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    return (
      <div className="flex min-h-screen bg-[#FAFAF8] items-center justify-center">
        <p className="text-sm" style={{ color: "#C0574C" }}>Farm not found.</p>
      </div>
    );
  }

  const [censusData, alerts, dashData, overdueCensus] = await Promise.all([
    getLatestCensusData(prisma),
    gameModule.getAlerts(prisma, farmSlug, {}),
    gameModule.getDashboardData(prisma),
    getSpeciesWithOverdueCensus(prisma),
  ]);

  const speciesSpecific = dashData.speciesSpecific as {
    speciesCount: number;
    latestCensusDate: string | null;
  };

  const freshness = censusFreshness(censusData.latestCensusDate);

  return (
    <div className="min-w-0 p-4 md:p-8 max-w-5xl bg-[#FAFAF8]">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#1C1815" }}>
          Game Census
        </h1>
        <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
          Population overview and census status
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Total Population"
          value={censusData.totalPopulation}
          sub={censusData.totalPopulation > 0 ? "Estimated head count" : "No census data"}
          status={censusData.totalPopulation > 0 ? "good" : "neutral"}
        />
        <KpiCard
          label="Species Tracked"
          value={speciesSpecific.speciesCount}
          sub={speciesSpecific.speciesCount > 0 ? "Active species" : "None configured"}
          status={speciesSpecific.speciesCount > 0 ? "neutral" : "alert"}
        />
        <KpiCard
          label="Last Census"
          value={censusData.latestCensusDate ? formatDate(censusData.latestCensusDate) : "—"}
          sub={
            !censusData.latestCensusDate ? "No census recorded" :
            freshness === "good"    ? "Up to date" :
            freshness === "warning" ? "Getting stale" :
                                      "Overdue"
          }
          status={freshness}
        />
        <KpiCard
          label="Census Overdue"
          value={overdueCensus.length}
          sub={overdueCensus.length > 0 ? "Species need counting" : "All up to date"}
          status={overdueCensus.length > 0 ? "alert" : "good"}
        />
      </div>

      {/* Alert Cards */}
      {alerts.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          {alerts.map((alert) => (
            <div key={alert.id} className="flex-1 min-w-0">
              <AlertCard alert={alert} />
            </div>
          ))}
        </div>
      )}

      {/* Tables (side by side) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SpeciesPopulationTable species={Object.values(censusData.bySpecies)} />
        <OverdueCensusTable species={overdueCensus} />
      </div>
    </div>
  );
}
