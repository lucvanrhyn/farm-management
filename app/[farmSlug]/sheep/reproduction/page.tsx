import Link from "next/link";
import { AlertTriangle, Baby, Droplets, Scissors } from "lucide-react";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmCreds } from "@/lib/meta-db";
import { sheepModule } from "@/lib/species/sheep/index";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import UpcomingLambingsTable from "@/components/sheep/UpcomingLambingsTable";
import OverdueLambingsTable from "@/components/sheep/OverdueLambingsTable";
import type { SpeciesAlert } from "@/lib/species/types";

export const dynamic = "force-dynamic";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function lambingPctStatus(pct: number | null): "good" | "warning" | "alert" | "neutral" {
  if (pct === null) return "neutral";
  if (pct >= 85)   return "good";
  if (pct >= 70)   return "warning";
  return "alert";
}

const STATUS_COLORS = {
  good:    { color: "#166534", bg: "rgba(34,197,94,0.1)" },
  warning: { color: "#92400E", bg: "rgba(245,158,11,0.12)" },
  alert:   { color: "#991B1B", bg: "rgba(220,38,38,0.1)" },
  neutral: { color: "#9C8E7A", bg: "rgba(156,142,122,0.1)" },
};

const ALERT_ICONS: Record<string, React.ElementType> = {
  Baby,
  AlertTriangle,
  Droplets,
  Scissors,
};

const EVENT_DOT: Record<string, string> = {
  lambing:  "#0D9488",
  joining:  "#8B6914",
  shearing: "#9C8E7A",
};

const EVENT_LABEL: Record<string, string> = {
  lambing:  "Lambing",
  joining:  "Joining",
  shearing: "Shearing",
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

export default async function SheepReproductionPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  const creds = await getFarmCreds(farmSlug);
  if (creds?.tier === "basic") {
    return <UpgradePrompt feature="Sheep Management" farmSlug={farmSlug} />;
  }

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    return (
      <div className="flex min-h-screen bg-[#FAFAF8] items-center justify-center">
        <p className="text-sm" style={{ color: "#C0574C" }}>Farm not found.</p>
      </div>
    );
  }

  const [reproStats, alerts, dashData, recentEvents, allCamps] = await Promise.all([
    sheepModule.getReproStats(prisma),
    sheepModule.getAlerts(prisma, farmSlug, {}),
    sheepModule.getDashboardData(prisma),
    prisma.observation.findMany({
      where: { type: { in: ["lambing", "joining", "shearing"] } },
      orderBy: { observedAt: "desc" },
      take: 10,
      select: { type: true, observedAt: true, animalId: true, campId: true },
    }),
    prisma.camp.findMany({ select: { campId: true, campName: true } }),
  ]);

  const campMap = new Map(allCamps.map((c) => [c.campId, c.campName]));

  const lambingPct = reproStats.lambingPercentage as number | null | undefined ?? null;
  const lambings12m = (reproStats.lambings12m as number | undefined) ?? 0;
  const joinings12m = (reproStats.joinings12m as number | undefined) ?? 0;
  const due30d = reproStats.upcomingBirths.filter(
    (b) => b.daysAway >= 0 && b.daysAway <= 30,
  ).length;

  const ss = dashData.speciesSpecific as { ewesActive: number; ramsActive: number; lambsActive: number };

  return (
    <div className="min-w-0 p-4 md:p-8 max-w-5xl bg-[#FAFAF8]">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#1C1815" }}>
          Lambing Dashboard
        </h1>
        <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
          Sheep reproduction · 12-month window · SA benchmark: ≥85% lambing rate
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Lambing %"
          value={lambingPct !== null ? `${lambingPct}%` : "—"}
          sub={
            lambingPct === null ? "Log lambing events" :
            lambingPct >= 85    ? "SA target met (≥85%)" :
            lambingPct >= 70    ? "Below SA target" :
                                  "Well below SA target"
          }
          status={lambingPctStatus(lambingPct)}
        />
        <KpiCard
          label="Joinings (12mo)"
          value={joinings12m}
          sub="Joining observations"
          status="neutral"
        />
        <KpiCard
          label="Lambings (12mo)"
          value={lambings12m}
          sub="Lambing observations"
          status="neutral"
        />
        <KpiCard
          label="Due <30 days"
          value={due30d}
          sub={due30d > 0 ? "Ewes due soon" : "None imminent"}
          status={due30d > 0 ? "warning" : "neutral"}
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

      {/* Lambing Tables (side by side) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <UpcomingLambingsTable births={reproStats.upcomingBirths} />
        <OverdueLambingsTable births={reproStats.upcomingBirths} />
      </div>

      {/* Bottom Row: Recent Events + Flock Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Recent Events Timeline */}
        <div
          className="rounded-2xl border"
          style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
        >
          <div className="px-5 py-4 border-b" style={{ borderColor: "#E0D5C8" }}>
            <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
              Recent Events
            </h2>
          </div>
          {recentEvents.length === 0 ? (
            <p className="px-5 py-5 text-sm" style={{ color: "#9C8E7A" }}>
              No recent sheep events recorded.
            </p>
          ) : (
            <div className="px-5 py-4 relative" style={{ borderLeft: "2px solid #E0D5C8", marginLeft: "28px" }}>
              {recentEvents.map((obs, i) => {
                const dotColor = EVENT_DOT[obs.type] ?? "#9C8E7A";
                const label = EVENT_LABEL[obs.type] ?? obs.type;
                const campName = campMap.get(obs.campId) ?? obs.campId;

                return (
                  <div
                    key={`${obs.type}-${obs.observedAt.toISOString()}-${i}`}
                    className="relative flex items-start gap-4 pl-5 py-2 -ml-px"
                  >
                    <div
                      className="absolute left-0 top-[11px] w-2.5 h-2.5 rounded-full -translate-x-[6px]"
                      style={{ background: dotColor, border: "2px solid #FFFFFF", boxShadow: `0 0 0 1px ${dotColor}` }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: "#1C1815" }}>
                        {label}
                      </p>
                      <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
                        {formatDate(obs.observedAt)}
                        {obs.animalId && ` · ${obs.animalId}`}
                        {` · ${campName}`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Flock Summary */}
        <div
          className="rounded-2xl border"
          style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
        >
          <div className="px-5 py-4 border-b" style={{ borderColor: "#E0D5C8" }}>
            <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
              Flock Summary
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
              Active sheep by category
            </p>
          </div>
          <div className="px-5 py-4 flex flex-col gap-3">
            {(
              [
                { label: "Ewes",  value: ss.ewesActive },
                { label: "Rams",  value: ss.ramsActive },
                { label: "Lambs", value: ss.lambsActive },
              ] as const
            ).map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-sm" style={{ color: "#6B5E50" }}>{label}</span>
                <span className="text-sm font-bold tabular-nums" style={{ color: "#1C1815" }}>
                  {value}
                </span>
              </div>
            ))}
            <div
              className="flex items-center justify-between pt-3 mt-1"
              style={{ borderTop: "1px solid #E0D5C8" }}
            >
              <span className="text-sm font-semibold" style={{ color: "#1C1815" }}>Total</span>
              <span className="text-sm font-bold tabular-nums" style={{ color: "#1C1815" }}>
                {dashData.activeCount}
              </span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
