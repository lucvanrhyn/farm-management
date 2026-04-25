export const dynamic = "force-dynamic";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmCreds } from "@/lib/meta-db";
import {
  getLatestCensusData,
  getQuotaUtilization,
} from "@/lib/species/game/analytics";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import QuotaUtilizationTable from "@/components/game/QuotaUtilizationTable";


// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS = {
  good:    { color: "#166534", bg: "rgba(34,197,94,0.1)" },
  warning: { color: "#92400E", bg: "rgba(245,158,11,0.12)" },
  alert:   { color: "#991B1B", bg: "rgba(220,38,38,0.1)" },
  neutral: { color: "#9C8E7A", bg: "rgba(156,142,122,0.1)" },
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function GameOfftakePage({
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

  const currentSeason = `${new Date().getFullYear()}`;
  const [quotaData, censusData] = await Promise.all([
    getQuotaUtilization(prisma, currentSeason),
    getLatestCensusData(prisma),
  ]);

  const activeQuotas = quotaData.length;
  const totalAllocated = quotaData.reduce((sum, q) => sum + q.totalQuota, 0);
  const totalUsed = quotaData.reduce((sum, q) => sum + q.usedTotal, 0);
  const hasAtRisk = quotaData.some((q) => q.atRisk);

  return (
    <div className="min-w-0 p-4 md:p-8 max-w-5xl bg-[#FAFAF8]">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#1C1815" }}>
          Offtake Planning
        </h1>
        <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
          {currentSeason} season · Quota utilisation and sustainable harvest
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard
          label="Active Quotas"
          value={activeQuotas}
          sub={activeQuotas > 0 ? "Species with quotas" : "None configured"}
          status={activeQuotas > 0 ? "neutral" : "neutral"}
        />
        <KpiCard
          label="Total Allocated"
          value={totalAllocated}
          sub="Across all species"
          status="neutral"
        />
        <KpiCard
          label="Total Used"
          value={totalUsed}
          sub={hasAtRisk ? "Some species at risk" : "Within limits"}
          status={hasAtRisk ? "alert" : "good"}
        />
      </div>

      {/* Quota Table */}
      <QuotaUtilizationTable quotas={quotaData} />

      {/* Population Context */}
      {censusData.totalPopulation > 0 && (
        <div className="mt-6">
          <div
            className="rounded-2xl border"
            style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
          >
            <div className="px-5 py-4 border-b" style={{ borderColor: "#E0D5C8" }}>
              <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
                Population Context
              </h2>
              <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
                Latest census population for reference
              </p>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              {Object.values(censusData.bySpecies).map((sp) => (
                <div key={sp.speciesId} className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: "#6B5E50" }}>{sp.commonName}</span>
                  <span className="text-sm font-bold tabular-nums" style={{ color: "#1C1815" }}>
                    {sp.totalCount}
                  </span>
                </div>
              ))}
              <div
                className="flex items-center justify-between pt-3 mt-1"
                style={{ borderTop: "1px solid #E0D5C8" }}
              >
                <span className="text-sm font-semibold" style={{ color: "#1C1815" }}>
                  Total Estimated
                </span>
                <span className="text-sm font-bold tabular-nums" style={{ color: "#1C1815" }}>
                  {censusData.totalPopulation}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
