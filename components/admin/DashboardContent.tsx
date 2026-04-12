import Link from "next/link";
import type { PrismaClient } from "@prisma/client";
import DangerZone from "@/components/admin/DangerZone";
import AnimatedNumber from "@/components/admin/AnimatedNumber";
import NeedsAttentionPanel from "@/components/admin/NeedsAttentionPanel";
import DataHealthCard from "@/components/admin/DataHealthCard";
import {
  PawPrint,
  Tent,
  ClipboardCheck,
  HeartPulse,
  Skull,
  Baby,
  FlaskConical,
  TrendingDown,
  Banknote,
  ClipboardList,
  FileDown,
  BarChart2,
  Lock,
  Mail,
  Phone,
} from "lucide-react";
import { getCachedDashboardOverview } from "@/lib/server/cached";
import { getSession } from "@/lib/auth";
import type { FarmTier } from "@/lib/tier";

interface Props {
  farmSlug: string;
  prisma: PrismaClient;
  tier: FarmTier;
}

export default async function DashboardContent({ farmSlug, prisma, tier }: Props) {
  const isBasic = tier === "basic";

  const session = await getSession();
  const isAdmin = (session?.user?.role as string | undefined) === "ADMIN";

  // Single cached call — all dashboard data in one cache entry (30s TTL).
  // On cache hit: zero Turso queries. On miss: all queries fire in parallel.
  const overview = await getCachedDashboardOverview(farmSlug);
  const {
    totalAnimals,
    totalCamps,
    reproStats,
    healthIssuesThisWeek,
    inspectedToday,
    recentHealth,
    lowGrazingCount,
    deathsToday,
    birthsToday,
    withdrawalCount,
    mtdTransactions,
    dataHealth,
    dashboardAlerts,
  } = overview;
  const liveConditions = new Map(Object.entries(overview.liveConditions));

  // ── Finance MTD ──────────────────────────────────────────────────────────────
  let mtdBalance = 0;
  for (const tx of mtdTransactions) {
    if (tx.type === "income") mtdBalance += tx.amount;
    else mtdBalance -= tx.amount;
  }
  const mtdFormatted = (() => {
    const abs = Math.abs(Math.round(mtdBalance));
    const formatted = abs.toLocaleString("en-ZA");
    return mtdBalance < 0 ? `−R ${formatted}` : `R ${formatted}`;
  })();

  // ── Poor doers ───────────────────────────────────────────────────────────────
  const poorDoerAlert = dashboardAlerts.amber.find(a => a.id === "poor-doers");
  const poorDoerCount = poorDoerAlert?.count ?? 0;

  // ── Camp grazing quality tally ────────────────────────────────────────────────
  const grazingCounts: Record<string, number> = { Good: 0, Fair: 0, Poor: 0, Overgrazed: 0 };
  if (liveConditions.size > 0) {
    for (const status of liveConditions.values()) {
      grazingCounts[status.grazing_quality] = (grazingCounts[status.grazing_quality] ?? 0) + 1;
    }
    const unrecorded = totalCamps - liveConditions.size;
    if (unrecorded > 0) grazingCounts["Fair"] = (grazingCounts["Fair"] ?? 0) + unrecorded;
  } else {
    grazingCounts.Good = 0;
    grazingCounts.Fair = totalCamps;
    grazingCounts.Poor = 0;
    grazingCounts.Overgrazed = 0;
  }

  return (
    <>
      {/* Low-grazing alert */}
      {lowGrazingCount > 0 && (
        <Link
          href={`/${farmSlug}/admin/performance`}
          className="flex items-center gap-2.5 rounded-xl px-4 py-3 mb-4 transition-opacity hover:opacity-80"
          style={{ background: "rgba(192,87,76,0.10)", border: "1px solid rgba(192,87,76,0.25)" }}
        >
          <span className="text-sm">⚠</span>
          <p className="text-sm font-medium" style={{ color: "#C0574C" }}>
            {lowGrazingCount} {lowGrazingCount === 1 ? "camp" : "camps"} with &lt;7 days grazing remaining
          </p>
          <span className="ml-auto text-xs font-mono" style={{ color: "#C0574C" }}>View Performance →</span>
        </Link>
      )}

      {/* Stats bar — 9 tiles */}
      <div
        className="rounded-2xl overflow-hidden mb-6"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
          {[
            {
              icon: PawPrint,
              iconColor: "#4A7C59",
              badge: "Active",
              badgeColor: "rgba(74,124,89,0.15)",
              badgeText: "#4A7C59",
              value: totalAnimals,
              label: "Total Animals",
              href: `/${farmSlug}/admin/animals`,
            },
            {
              icon: Tent,
              iconColor: "#8B6914",
              badge: "Farm Layout",
              badgeColor: "rgba(139,105,20,0.15)",
              badgeText: "#8B6914",
              value: totalCamps,
              label: "Total Camps",
              href: `/${farmSlug}/admin/camps`,
            },
            {
              icon: ClipboardCheck,
              iconColor: inspectedToday === totalCamps ? "#4A7C59" : "#8B6914",
              badge: `${Math.round((inspectedToday / (totalCamps || 1)) * 100)}% done`,
              badgeColor: inspectedToday === totalCamps ? "rgba(74,124,89,0.15)" : "rgba(139,105,20,0.15)",
              badgeText: inspectedToday === totalCamps ? "#4A7C59" : "#8B6914",
              value: `${inspectedToday}/${totalCamps}`,
              label: "Inspections Today",
              href: `/${farmSlug}/admin/observations`,
            },
            {
              icon: HeartPulse,
              iconColor: healthIssuesThisWeek === 0 ? "#4A7C59" : healthIssuesThisWeek > 3 ? "#8B3A3A" : "#A0522D",
              badge: healthIssuesThisWeek === 0 ? "All clear" : healthIssuesThisWeek > 3 ? "Critical" : "Monitor",
              badgeColor: healthIssuesThisWeek === 0 ? "rgba(74,124,89,0.15)" : healthIssuesThisWeek > 3 ? "rgba(139,58,58,0.15)" : "rgba(160,82,45,0.15)",
              badgeText: healthIssuesThisWeek === 0 ? "#4A7C59" : healthIssuesThisWeek > 3 ? "#8B3A3A" : "#A0522D",
              value: healthIssuesThisWeek,
              label: "Health Issues · 7d",
              href: `/${farmSlug}/admin/observations`,
            },
            {
              icon: Baby,
              iconColor: birthsToday > 0 ? "#4A7C59" : "#9C8E7A",
              badge: birthsToday > 0 ? "New calvings" : "None today",
              badgeColor: birthsToday > 0 ? "rgba(74,124,89,0.15)" : "rgba(156,142,122,0.12)",
              badgeText: birthsToday > 0 ? "#4A7C59" : "#9C8E7A",
              value: birthsToday,
              label: "Calvings Today",
              href: `/${farmSlug}/admin/reproduction`,
            },
            {
              icon: Skull,
              iconColor: deathsToday > 0 ? "#8B3A3A" : "#9C8E7A",
              badge: deathsToday > 0 ? "Alert" : "None today",
              badgeColor: deathsToday > 0 ? "rgba(139,58,58,0.15)" : "rgba(156,142,122,0.12)",
              badgeText: deathsToday > 0 ? "#8B3A3A" : "#9C8E7A",
              value: deathsToday,
              label: "Deaths Today",
              href: `/${farmSlug}/admin/observations`,
            },
            {
              icon: FlaskConical,
              iconColor: withdrawalCount > 0 ? "#C49030" : "#9C8E7A",
              badge: withdrawalCount > 0 ? "Caution" : "All clear",
              badgeColor: withdrawalCount > 0 ? "rgba(196,144,48,0.15)" : "rgba(156,142,122,0.12)",
              badgeText: withdrawalCount > 0 ? "#C49030" : "#9C8E7A",
              value: withdrawalCount,
              label: "In Withdrawal",
              href: `/${farmSlug}/admin/animals`,
            },
            {
              icon: TrendingDown,
              iconColor: poorDoerCount > 0 ? "#C0574C" : "#9C8E7A",
              badge: poorDoerCount > 0 ? "Monitor" : "All clear",
              badgeColor: poorDoerCount > 0 ? "rgba(192,87,76,0.12)" : "rgba(156,142,122,0.12)",
              badgeText: poorDoerCount > 0 ? "#C0574C" : "#9C8E7A",
              value: poorDoerCount,
              label: "Poor Doers",
              href: `/${farmSlug}/admin/animals`,
            },
            ...(!isBasic ? [{
              icon: Banknote,
              iconColor: mtdBalance < 0 ? "#C0574C" : "#4A7C59",
              badge: "Finance · MTD",
              badgeColor: mtdBalance < 0 ? "rgba(192,87,76,0.12)" : "rgba(74,124,89,0.12)",
              badgeText: mtdBalance < 0 ? "#C0574C" : "#4A7C59",
              value: mtdFormatted,
              label: "Revenue · MTD",
              href: `/${farmSlug}/admin/finansies`,
            }] : []),
          ].map(({ icon: Icon, iconColor, badge, badgeColor, badgeText, value, label, href }, i) => (
            <Link
              key={label}
              href={href}
              className="block p-3 sm:p-4 transition-colors hover:bg-[#F5F2EE]"
              style={{
                borderRight: i < 8 ? "1px solid rgba(139,105,20,0.12)" : undefined,
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: iconColor }} />
                <span
                  className="text-[10px] font-semibold rounded-full px-2 py-0.5 truncate"
                  style={{ background: badgeColor, color: badgeText }}
                >
                  {badge}
                </span>
              </div>
              <p className="text-xl sm:text-2xl font-bold font-mono truncate" style={{ color: "#1C1815" }}>
                {typeof value === "number" ? <AnimatedNumber value={value} /> : value}
              </p>
              <p className="text-xs mt-1 truncate" style={{ color: "#9C8E7A" }}>{label}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* Needs Attention panel */}
      <NeedsAttentionPanel alerts={dashboardAlerts} farmSlug={farmSlug} />

      {/* Bottom grid — 4 cards */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* Reproductive Overview — locked for basic tier */}
        {isBasic ? (
          <div
            className="rounded-xl p-4 flex flex-col"
            style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Lock className="w-3.5 h-3.5 shrink-0" style={{ color: "#8B6914" }} />
              <h2
                className="text-xs font-semibold uppercase tracking-wide"
                style={{ color: "#9C8E7A" }}
              >
                Advanced Features
              </h2>
            </div>
            <p className="text-xs mb-4 flex-1" style={{ color: "#6B5E50" }}>
              Upgrade to unlock Reproductive Analytics, Financial Tracking, and detailed Performance reports.
            </p>
            <div className="flex flex-col gap-2">
              <a
                href="mailto:contact@example.com"
                className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ background: "rgba(139,105,20,0.1)", color: "#8B6914", border: "1px solid rgba(139,105,20,0.25)" }}
              >
                <Mail className="w-3.5 h-3.5" />
                Contact us to upgrade
              </a>
              <a
                href="tel:+27000000000"
                className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ color: "#9C8E7A", border: "1px solid #E0D5C8" }}
              >
                <Phone className="w-3.5 h-3.5" />
                +27 000 000 0000
              </a>
            </div>
          </div>
        ) : (
          <div
            className="rounded-xl p-4 flex flex-col"
            style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
          >
            <h2
              className="text-xs font-semibold uppercase tracking-wide mb-3"
              style={{ color: "#9C8E7A" }}
            >
              Reproductive Overview
            </h2>
            {reproStats.inseminations30d === 0 &&
             reproStats.inHeat7d === 0 &&
             reproStats.calvingsDue30d === 0 &&
             reproStats.pregnancyRate === null &&
             reproStats.upcomingCalvings.length === 0 &&
             reproStats.scanCounts.pregnant === 0 &&
             reproStats.scanCounts.empty === 0 ? (
              <p className="text-xs flex-1" style={{ color: "#9C8E7A" }}>No reproductive events recorded yet.</p>
            ) : (
              <div className="flex-1">
                {reproStats.pregnancyRate !== null && reproStats.pregnancyRate < 70 && (
                  <div
                    className="flex items-center gap-2 rounded-lg px-3 py-2 mb-3"
                    style={{ background: "rgba(180,110,20,0.10)", border: "1px solid rgba(180,110,20,0.25)" }}
                  >
                    <span className="text-xs">⚠</span>
                    <p className="text-xs font-medium" style={{ color: "#A07010" }}>Below SA target (&lt;70%)</p>
                  </div>
                )}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: "#9C8E7A" }}>Pregnancy Rate</span>
                    <span className="text-sm font-bold font-mono" style={{ color: reproStats.pregnancyRate === null ? "#9C8E7A" : reproStats.pregnancyRate >= 85 ? "#4A7C59" : reproStats.pregnancyRate >= 70 ? "#8B6914" : "#8B3A3A" }}>
                      {reproStats.pregnancyRate !== null ? `${reproStats.pregnancyRate}%` : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between" style={{ borderTop: "1px solid #E0D5C8", paddingTop: "0.75rem" }}>
                    <span className="text-xs" style={{ color: "#9C8E7A" }}>Calvings Due · 30d</span>
                    <span className="text-sm font-bold font-mono" style={{ color: reproStats.calvingsDue30d > 0 ? "#8B6914" : "#1C1815" }}>
                      {reproStats.calvingsDue30d}
                    </span>
                  </div>
                  <div className="flex items-center justify-between" style={{ borderTop: "1px solid #E0D5C8", paddingTop: "0.75rem" }}>
                    <span className="text-xs" style={{ color: "#9C8E7A" }}>In Heat · 7d</span>
                    <span className="text-sm font-bold font-mono" style={{ color: "#1C1815" }}>
                      {reproStats.inHeat7d}
                    </span>
                  </div>
                </div>
              </div>
            )}
            <Link
              href={`/${farmSlug}/admin/reproduction`}
              className="mt-4 text-xs font-medium text-right block transition-opacity hover:opacity-70"
              style={{ color: "#8B6914" }}
            >
              View Reproduction →
            </Link>
          </div>
        )}

        {/* Recent Health Incidents */}
        <div
          className="rounded-xl p-4"
          style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
        >
          <h2
            className="text-xs font-semibold uppercase tracking-wide mb-3"
            style={{ color: "#9C8E7A" }}
          >
            Recent Health Incidents
          </h2>
          {recentHealth.length === 0 ? (
            <p className="text-xs" style={{ color: "#9C8E7A" }}>No health incidents recorded.</p>
          ) : (
            <div className="flex flex-col">
              {recentHealth.map((obs) => (
                <div
                  key={obs.id}
                  className="flex items-start gap-2.5 py-1.5 last:border-0"
                  style={{ borderBottom: "1px solid #E0D5C8" }}
                >
                  <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: "#A0522D" }} />
                  <div>
                    <p className="text-xs font-medium font-mono" style={{ color: "#1C1815" }}>
                      {obs.animalId ?? "Unknown"} · Camp {obs.campId}
                    </p>
                    <p className="text-xs" style={{ color: "#9C8E7A" }}>
                      {Array.isArray(obs.details.symptoms) ? obs.details.symptoms.join(", ") : "Health issue"}
                      {" · "}
                      {obs.observedAt.split("T")[0]}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Camp Status Summary */}
        <div
          className="rounded-xl p-4"
          style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
        >
          <h2
            className="text-xs font-semibold uppercase tracking-wide mb-3"
            style={{ color: "#9C8E7A" }}
          >
            Camp Status Summary
          </h2>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {[
              ...Array(grazingCounts.Good ?? 0).fill({ color: "#4A7C59", label: "Good" }),
              ...Array(grazingCounts.Fair ?? 0).fill({ color: "#8B6914", label: "Fair" }),
              ...Array(grazingCounts.Poor ?? 0).fill({ color: "#A0522D", label: "Poor" }),
              ...Array(grazingCounts.Overgrazed ?? 0).fill({ color: "#8B3A3A", label: "Overgrazed" }),
            ].map((item: { color: string; label: string }, i: number) => (
              <div
                key={i}
                className="w-3 h-3 rounded-full shrink-0"
                style={{ background: item.color }}
                title={item.label}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {[
              { label: "Good",       color: "#4A7C59", quality: "Good"       },
              { label: "Fair",       color: "#8B6914", quality: "Fair"       },
              { label: "Poor",       color: "#A0522D", quality: "Poor"       },
              { label: "Overgrazed", color: "#8B3A3A", quality: "Overgrazed" },
            ].map(({ label, color, quality }) => (
              <span key={quality} className="flex items-center gap-1.5 text-[11px]" style={{ color: "#9C8E7A" }}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                {label}
                <span className="font-mono font-semibold" style={{ color: "#1C1815" }}>
                  {grazingCounts[quality] ?? 0}
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div
          className="rounded-xl p-4"
          style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
        >
          <h2
            className="text-xs font-semibold uppercase tracking-wide mb-3"
            style={{ color: "#9C8E7A" }}
          >
            Quick Actions
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {[
              {
                icon: ClipboardList,
                label: "Log Observation",
                href: `/${farmSlug}/logger`,
              },
              {
                icon: PawPrint,
                label: "View Animals",
                href: `/${farmSlug}/admin/animals`,
              },
              {
                icon: FileDown,
                label: "View Reports",
                href: `/${farmSlug}/admin/reports`,
              },
              ...(!isBasic ? [{
                icon: BarChart2,
                label: "Camp Performance",
                href: `/${farmSlug}/admin/performance`,
              }] : []),
            ].map(({ icon: Icon, label, href }) => (
              <Link
                key={label}
                href={href}
                className="flex flex-col items-center gap-2 rounded-xl px-3 py-4 transition-colors hover:bg-[#F5F2EE]"
                style={{ border: "1px solid #E0D5C8" }}
              >
                <Icon className="w-5 h-5" style={{ color: "#4A7C59" }} />
                <span className="text-xs font-medium text-center leading-tight" style={{ color: "#1C1815" }}>
                  {label}
                </span>
              </Link>
            ))}
          </div>
        </div>

        {/* Data Health */}
        <DataHealthCard score={dataHealth} />
      </div>

      {isAdmin && (
        <div className="mt-4">
          <DangerZone />
        </div>
      )}
    </>
  );
}
