export const dynamic = "force-dynamic";
import { Suspense } from "react";
import Link from "next/link";
import MobKPICard from "@/components/admin/MobKPICard";
import UpcomingCalvingsTable from "@/components/admin/UpcomingCalvingsTable";
import ExportButton from "@/components/admin/ExportButton";
import DateRangePicker from "@/components/admin/DateRangePicker";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getReproStats } from "@/lib/server/reproduction-analytics";
import { getFarmMode } from "@/lib/server/get-farm-mode";
import nextDynamic from "next/dynamic";

const PregnancyRateCycleChart = nextDynamic(
  () => import("@/components/admin/charts/PregnancyRateCycleChart"),
  { loading: () => <div className="h-48 animate-pulse bg-gray-100 rounded-lg" /> },
);
const DaysOpenHistogram = nextDynamic(
  () => import("@/components/admin/charts/DaysOpenHistogram"),
  { loading: () => <div className="h-48 animate-pulse bg-gray-100 rounded-lg" /> },
);
const WeaningRateKPI = nextDynamic(
  () => import("@/components/admin/charts/WeaningRateKPI"),
  { loading: () => <div className="h-12 animate-pulse bg-gray-100 rounded-lg" /> },
);
import GestationCalculator from "@/components/admin/charts/GestationCalculator";
import { getFarmCreds } from "@/lib/meta-db";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import { COPY_BY_MODE } from "./copy";
import type { GestationBreed } from "@/lib/species/gestation";
import AdminPage from "@/app/_components/AdminPage";


function formatDate(date: Date): string {
  return date.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

function calvingUrgency(daysAway: number): "good" | "warning" | "alert" {
  if (daysAway < 0) return "alert"; // overdue
  if (daysAway <= 14) return "alert";
  if (daysAway <= 30) return "warning";
  return "good";
}

function parseDetails(raw: string): Record<string, string> {
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function pregnancyRateStatus(rate: number | null): "good" | "warning" | "alert" | "neutral" {
  if (rate === null) return "neutral";
  if (rate >= 85) return "good";
  if (rate >= 70) return "warning";
  return "alert";
}

function calvingIntervalStatus(days: number | null): "good" | "warning" | "alert" | "neutral" {
  if (days === null) return "neutral";
  if (days <= 365) return "good";
  if (days <= 395) return "warning";
  return "alert";
}

// Default breed shown first in the Gestation Calculator, per species mode.
// Avoids dropping users on an irrelevant breed ("Bonsmara" for a sheep farm).
function defaultBreedForMode(mode: "cattle" | "sheep" | "game"): GestationBreed {
  if (mode === "sheep") return "sheep_dohne";
  if (mode === "game") return "kudu";
  return "cattle_bonsmara";
}

export default async function ReproductionPage({
  params,
  searchParams,
}: {
  params: Promise<{ farmSlug: string }>;
  searchParams?: Promise<{ from?: string; to?: string }>;
}) {
  const { farmSlug } = await params;
  const { from, to } = searchParams ? await searchParams : {};

  const creds = await getFarmCreds(farmSlug);
  if (creds?.tier === "basic") {
    return <UpgradePrompt feature="Reproductive Performance" farmSlug={farmSlug} />;
  }

  const prisma = await getPrismaForFarm(farmSlug);

  if (!prisma) {
    return (
      <AdminPage>
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-red-500 text-sm">Farm not found.</p>
        </div>
      </AdminPage>
    );
  }

  const mode = await getFarmMode(farmSlug);
  const copy = COPY_BY_MODE[mode] ?? COPY_BY_MODE.cattle;

  // Phase I.3 — scope repro queries via the denormalised Observation.species
  // column instead of prefetching every animalId of the active species and
  // threading an animalId-IN list of ~874 entries through every sub-query.
  // The composite index `idx_observation_species_animal` (migration 0003)
  // serves the predicate.
  const stats = await getReproStats(prisma, { species: mode });

  // Fetch recent events (last 15) — includes heat/insem/scan/calving
  // Default to 12 months when no date range is selected
  const defaultFrom = new Date();
  defaultFrom.setFullYear(defaultFrom.getFullYear() - 1);
  const fromDate = from ? new Date(from) : defaultFrom;
  const toDate = to ? new Date(to) : undefined;

  const observedAtFilter: Record<string, unknown> = { gte: fromDate };
  if (toDate) observedAtFilter.lte = toDate;

  // Include species-specific birth events (lambing for sheep, fawning for game)
  // alongside the shared heat/insemination/scan events so the recent-events
  // timeline shows the correct species' birth type.
  const birthEventTypes =
    mode === "sheep" ? ["lambing"] : mode === "game" ? ["fawning"] : ["calving"];

  const [recentEvents, allCamps] = await Promise.all([
    prisma.observation.findMany({
      where: {
        type: { in: ["heat_detection", "insemination", "pregnancy_scan", ...birthEventTypes] },
        observedAt: observedAtFilter,
        species: mode,
      },
      orderBy: { observedAt: "desc" },
      take: 15,
      select: { id: true, type: true, animalId: true, campId: true, observedAt: true, loggedBy: true, details: true },
    }),
    // audit-allow-findmany: bounded per-tenant camp list for name lookup (~36 camps).
    prisma.camp.findMany({ select: { campId: true, campName: true } }),
  ]);

  const campMap = new Map(allCamps.map((c) => [c.campId, c.campName]));
  const totalEvents = stats.inHeat7d + stats.inseminations30d + stats.scanCounts.pregnant + stats.scanCounts.empty + stats.scanCounts.uncertain + stats.daysOpen.length;

  return (
    <AdminPage className="max-w-5xl">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "#1C1815" }}>
              {copy.pageTitle}
            </h1>
            <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
              {totalEvents > 0
                ? copy.benchmarkLine
                : `No reproductive events recorded yet — log heat, insemination, scan or ${copy.birthEventLower} events via the Logger`}
            </p>
          </div>
          <ExportButton farmSlug={farmSlug} exportType="calvings" label="Export" />
        </div>

        {/* Date range filter */}
        <div className="mb-6">
          <Suspense fallback={<div className="h-9" />}>
            <DateRangePicker defaultDays={365} />
          </Suspense>
        </div>

        {/* Upcoming Calvings — shown at top for immediate visibility */}
        <UpcomingCalvingsTable calvings={stats.upcomingCalvings} />

        {/* KPI grid — Row 1: Rate KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <MobKPICard
            label="Pregnancy Rate"
            value={stats.pregnancyRate !== null ? `${stats.pregnancyRate}%` : "—"}
            sub={
              stats.pregnancyRate === null
                ? copy.logHint
                : stats.pregnancyRate >= 85
                ? "SA target met (≥85%)"
                : stats.pregnancyRate >= 70
                ? "Below SA target (≥85%)"
                : "Well below SA target"
            }
            status={pregnancyRateStatus(stats.pregnancyRate)}
            icon="🔬"
          />
          <MobKPICard
            label={`${copy.birthEvent} Rate`}
            value={stats.calvingRate !== null ? `${stats.calvingRate}%` : "—"}
            sub={
              stats.calvingRate === null
                ? copy.logHint
                : stats.calvingRate >= 85
                ? "SA target met (≥85%)"
                : stats.calvingRate >= 70
                ? "Below SA target (≥85%)"
                : "Well below SA target"
            }
            status={pregnancyRateStatus(stats.calvingRate)}
            icon="🐮"
          />
          <MobKPICard
            label={copy.intervalLabel}
            value={stats.avgCalvingIntervalDays !== null ? `${stats.avgCalvingIntervalDays}d` : "—"}
            sub={
              stats.avgCalvingIntervalDays === null
                ? `Need ≥2 ${copy.birthEventLower}s per animal`
                : stats.avgCalvingIntervalDays <= 365
                ? "ARC target met (≤365d)"
                : stats.avgCalvingIntervalDays <= 395
                ? "Above ARC target (≤365d)"
                : "Well above ARC target"
            }
            status={calvingIntervalStatus(stats.avgCalvingIntervalDays)}
            icon="📅"
          />
        </div>

        {/* KPI grid — Row 1b: Weaning + Days Open KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <MobKPICard
            label={copy.weanedLabel}
            value={stats.weaningRate !== null ? `${stats.weaningRate}%` : "—"}
            sub={
              stats.weaningRate === null
                ? copy.logHint
                : stats.weaningRate >= 80
                ? "SA target met (≥80%)"
                : stats.weaningRate >= 65
                ? "Below SA target (≥80%)"
                : "Well below SA target"
            }
            status={
              stats.weaningRate === null ? "neutral"
              : stats.weaningRate >= 80 ? "good"
              : stats.weaningRate >= 65 ? "warning"
              : "alert"
            }
            icon="🐂"
          />
          <MobKPICard
            label="Avg Days Open"
            value={stats.avgDaysOpen !== null ? `${stats.avgDaysOpen}d` : "—"}
            sub={
              stats.avgDaysOpen === null
                ? `Need ${copy.birthEventLower} + scan records`
                : stats.avgDaysOpen <= 90
                ? "SA target met (<90d)"
                : stats.avgDaysOpen <= 120
                ? "Above SA target (<90d)"
                : "Well above SA target — investigate"
            }
            status={
              stats.avgDaysOpen === null ? "neutral"
              : stats.avgDaysOpen <= 90 ? "good"
              : stats.avgDaysOpen <= 120 ? "warning"
              : "alert"
            }
            icon="📆"
          />
        </div>

        {/* Weaning Rate KPI tile (§E point 3) — large value + sparkline when
            historical data available. `history` is intentionally empty today:
            multi-year weaning trend requires a calvings-by-year aggregation
            that would need a new Prisma query (out of scope for J5). Tile
            still renders the current number + legend. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <WeaningRateKPI weaningRate={stats.weaningRate} history={[]} />
        </div>

        {/* KPI grid — Row 2: Activity KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <MobKPICard
            label="In Heat (7 days)"
            value={stats.inHeat7d}
            sub={stats.inHeat7d === 0 ? "No animals flagged" : "Animals showing oestrus"}
            status={stats.inHeat7d > 0 ? "warning" : "neutral"}
            icon="🔥"
          />
          <MobKPICard
            label="Inseminations (30 days)"
            value={stats.inseminations30d}
            sub={stats.inseminations30d === 0 ? "None recorded" : "Services logged"}
            status={stats.inseminations30d > 0 ? "good" : "neutral"}
            icon="💉"
          />
          <MobKPICard
            label={`${copy.birthEvent}s Due (30 days)`}
            value={stats.calvingsDue30d}
            sub={
              stats.upcomingCalvings.length === 0
                ? "No inseminations on record"
                : `Based on scan/insem + ${copy.gestationDays}d gestation`
            }
            status={stats.calvingsDue30d > 0 ? "warning" : "neutral"}
            icon="🐄"
          />
        </div>

        {/* Expected Births (species-aware) */}
        <div
          className="rounded-2xl border mb-6"
          style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
        >
          <div className="px-6 py-4 border-b" style={{ borderColor: "#E0D5C8" }}>
            <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
              Expected {copy.birthEvent}s
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
              Scan date (preferred) or insemination date + {copy.gestationDays} days · showing next 90 days
            </p>
          </div>
          {stats.upcomingCalvings.length === 0 ? (
            <p className="px-6 py-5 text-sm" style={{ color: "#9C8E7A" }}>
              No upcoming {copy.birthEventLower}s calculated. Log insemination or scan events via the Logger to track
              expected {copy.birthEventLower} dates.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-xs font-semibold uppercase tracking-wide"
                    style={{ color: "#9C8E7A", borderBottom: "1px solid #E0D5C8" }}
                  >
                    <th className="px-6 py-3 text-left">Animal</th>
                    <th className="px-4 py-3 text-left">Camp</th>
                    <th className="px-4 py-3 text-left">Source</th>
                    <th className="px-4 py-3 text-left">Expected {copy.birthEvent}</th>
                    <th className="px-4 py-3 text-right">Days Away</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.upcomingCalvings.map((c) => {
                    const urgency = calvingUrgency(c.daysAway);
                    return (
                      <tr
                        key={c.animalId}
                        className="border-b last:border-0"
                        style={{ borderColor: "#F0EAE0" }}
                      >
                        <td className="px-6 py-3">
                          <Link
                            href={`/${farmSlug}/admin/animals/${c.animalId}?tab=reproduction`}
                            className="font-mono font-semibold hover:underline"
                            style={{ color: "#1C1815" }}
                          >
                            {c.animalId}
                          </Link>
                        </td>
                        <td className="px-4 py-3" style={{ color: "#6B5E50" }}>
                          {c.campName}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={
                              c.source === "scan"
                                ? { backgroundColor: "rgba(74,124,89,0.1)", color: "#3A6B49" }
                                : { backgroundColor: "rgba(139,105,20,0.12)", color: "#7A5C00" }
                            }
                          >
                            {c.source === "scan" ? "🔬 Scan" : "💉 Insem"}
                          </span>
                        </td>
                        <td className="px-4 py-3 tabular-nums" style={{ color: "#1C1815" }}>
                          {formatDate(c.expectedCalving)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className="text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full"
                            style={
                              urgency === "alert"
                                ? { backgroundColor: "rgba(220,38,38,0.1)", color: "#991B1B" }
                                : urgency === "warning"
                                ? { backgroundColor: "rgba(245,158,11,0.12)", color: "#92400E" }
                                : { backgroundColor: "rgba(34,197,94,0.1)", color: "#166534" }
                            }
                          >
                            {c.daysAway < 0
                              ? `${Math.abs(c.daysAway)}d overdue`
                              : `${c.daysAway}d`}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pregnancy Scan Results */}
        <div
          className="rounded-2xl border mb-6"
          style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
        >
          <div className="px-6 py-4 border-b" style={{ borderColor: "#E0D5C8" }}>
            <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
              Pregnancy Scan Results
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
              Most recent scan per animal · SA target ≥85% pregnancy rate
            </p>
          </div>
          <div className="px-6 py-5 grid grid-cols-3 gap-4">
            {(
              [
                {
                  key: "pregnant" as const,
                  label: "Pregnant",
                  color: "#166534",
                  bg: "rgba(34,197,94,0.08)",
                  border: "rgba(34,197,94,0.2)",
                },
                {
                  key: "empty" as const,
                  label: "Empty",
                  color: "#991B1B",
                  bg: "rgba(220,38,38,0.07)",
                  border: "rgba(220,38,38,0.2)",
                },
                {
                  key: "uncertain" as const,
                  label: "Recheck",
                  color: "#92400E",
                  bg: "rgba(245,158,11,0.08)",
                  border: "rgba(245,158,11,0.25)",
                },
              ] as const
            ).map((item) => (
              <div
                key={item.key}
                className="rounded-xl p-4 text-center"
                style={{ backgroundColor: item.bg, border: `1px solid ${item.border}` }}
              >
                <p className="text-3xl font-bold tabular-nums" style={{ color: item.color }}>
                  {stats.scanCounts[item.key]}
                </p>
                <p className="text-xs font-medium mt-1" style={{ color: item.color }}>
                  {item.label}
                </p>
              </div>
            ))}
          </div>
          {stats.conceptionRate !== null && (
            <div
              className="px-6 pb-5 pt-1 flex items-center gap-2"
              style={{ borderTop: "1px solid #F0EAE0" }}
            >
              <span className="text-sm font-semibold" style={{ color: "#1C1815" }}>
                Scan conception rate:
              </span>
              <span
                className="text-sm font-bold px-2 py-0.5 rounded-full"
                style={
                  stats.conceptionRate >= 85
                    ? { backgroundColor: "rgba(34,197,94,0.1)", color: "#166534" }
                    : stats.conceptionRate >= 70
                    ? { backgroundColor: "rgba(245,158,11,0.12)", color: "#92400E" }
                    : { backgroundColor: "rgba(220,38,38,0.1)", color: "#991B1B" }
                }
              >
                {stats.conceptionRate}%
              </span>
              <span className="text-xs" style={{ color: "#9C8E7A" }}>
                (target ≥85%)
              </span>
            </div>
          )}
        </div>

        {/* 21-Day Pregnancy Rate by Cycle */}
        <div
          className="rounded-2xl border mb-6"
          style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
        >
          <div className="px-6 py-4 border-b" style={{ borderColor: "#E0D5C8" }}>
            <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
              21-Day Pregnancy Rate — by Cycle
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
              Confirmed pregnancies per 21-day estrus window · SA target: &gt;22% per cycle
            </p>
          </div>
          <div className="px-6 py-4">
            <PregnancyRateCycleChart cycles={stats.pregnancyRateByCycle} />
          </div>
        </div>

        {/* Days Open Distribution histogram (§E point 2) */}
        <div
          className="rounded-2xl border mb-6"
          style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
        >
          <div className="px-6 py-4 border-b" style={{ borderColor: "#E0D5C8" }}>
            <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
              Days Open Distribution
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
              Binned by 20-day intervals · SA target ≤95d (UT Beef W973)
            </p>
          </div>
          <div className="px-6 py-4">
            <DaysOpenHistogram records={stats.daysOpen} avgDaysOpen={stats.avgDaysOpen} />
          </div>
        </div>

        {/* Days Open table — Phase I.4: SSR is capped at DAYS_OPEN_SSR_LIMIT.
            Prior implementation rendered one <tr> per animal unbounded; on a
            tenant with several hundred cows this blew the HTML payload. The
            full list is still available via the CSV/PDF export (header
            "Export" button). */}
        {stats.daysOpen.length > 0 && (() => {
          const DAYS_OPEN_SSR_LIMIT = 50;
          // `sort` mutates in place, which surprises React's strict-mode
          // double-render. Defensively copy first, then slice the top-N by
          // days-open descending (null treated as "still open" → largest).
          const sorted = [...stats.daysOpen].sort(
            (a, b) => (b.daysOpen ?? 9999) - (a.daysOpen ?? 9999),
          );
          const visible = sorted.slice(0, DAYS_OPEN_SSR_LIMIT);
          const hiddenCount = sorted.length - visible.length;
          return (
          <div
            className="rounded-2xl border mb-6"
            style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
          >
            <div className="px-6 py-4 border-b" style={{ borderColor: "#E0D5C8" }}>
              <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
                Days Open — Per Animal
              </h2>
              <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
                Days from {copy.birthEventLower} to confirmed conception · SA target: &lt;90 days
                {hiddenCount > 0 && (
                  <>
                    {" · "}showing worst {visible.length} of {sorted.length}
                  </>
                )}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-xs font-semibold uppercase tracking-wide"
                    style={{ color: "#9C8E7A", borderBottom: "1px solid #E0D5C8" }}
                  >
                    <th className="px-6 py-3 text-left">Animal</th>
                    <th className="px-4 py-3 text-left">Last {copy.birthEvent}</th>
                    <th className="px-4 py-3 text-left">Conception Date</th>
                    <th className="px-4 py-3 text-right">Days Open</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                      <tr
                        key={row.animalId}
                        className="border-b last:border-0"
                        style={{ borderColor: "#F0EAE0" }}
                      >
                        <td className="px-6 py-3">
                          <Link
                            href={`/${farmSlug}/admin/animals/${row.animalId}?tab=reproduction`}
                            className="font-mono font-semibold hover:underline"
                            style={{ color: "#1C1815" }}
                          >
                            {row.animalId}
                          </Link>
                        </td>
                        <td className="px-4 py-3 tabular-nums" style={{ color: "#6B5E50" }}>
                          {formatDate(row.calvingDate)}
                        </td>
                        <td className="px-4 py-3 tabular-nums" style={{ color: "#6B5E50" }}>
                          {row.conceptionDate ? formatDate(row.conceptionDate) : (
                            <span style={{ color: "#C0574C", fontStyle: "italic" }}>No return to service</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {row.daysOpen !== null ? (
                            <span
                              className="text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full"
                              style={
                                row.daysOpen <= 90
                                  ? { backgroundColor: "rgba(34,197,94,0.1)", color: "#166534" }
                                  : row.daysOpen <= 120
                                  ? { backgroundColor: "rgba(245,158,11,0.12)", color: "#92400E" }
                                  : { backgroundColor: "rgba(220,38,38,0.1)", color: "#991B1B" }
                              }
                            >
                              {row.daysOpen}d
                            </span>
                          ) : (
                            <span
                              className="text-xs font-semibold px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: "rgba(220,38,38,0.1)", color: "#991B1B" }}
                            >
                              Open
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {hiddenCount > 0 && (
              <div
                className="px-6 py-3 text-xs border-t"
                style={{ color: "#9C8E7A", borderColor: "#F0EAE0" }}
              >
                {hiddenCount} more {hiddenCount === 1 ? "animal" : "animals"} not shown —
                use the Export button for the full list.
              </div>
            )}
          </div>
          );
        })()}

        {/* Gestation Calculator (§E point 4) — breed-aware expected birth window */}
        <div className="mb-6">
          <GestationCalculator copy={copy} defaultBreed={defaultBreedForMode(mode)} />
        </div>

        {/* Recent Events timeline */}
        <div
          className="rounded-2xl border"
          style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
        >
          <div className="px-6 py-4 border-b" style={{ borderColor: "#E0D5C8" }}>
            <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
              Recent Events
            </h2>
          </div>
          {recentEvents.length === 0 ? (
            <p className="px-6 py-5 text-sm" style={{ color: "#9C8E7A" }}>
              No reproductive events recorded yet.
            </p>
          ) : (
            <div className="px-6 py-4 relative" style={{ borderLeft: "2px solid #E0D5C8", marginLeft: "29px" }}>
              {recentEvents.map((obs) => {
                const det = parseDetails(obs.details);
                const campName = campMap.get(obs.campId) ?? obs.campId;

                const DOT_COLORS: Record<string, string> = {
                  heat_detection: "#D47EB5",
                  insemination: "#8B6914",
                  pregnancy_scan: "#4A7C59",
                  calving: "#0D9488",
                  lambing: "#0D9488",
                  fawning: "#0D9488",
                };
                const EVENT_LABELS: Record<string, string> = {
                  heat_detection: "Heat detected",
                  insemination: "Insemination",
                  pregnancy_scan: "Pregnancy scan",
                  calving: "Calving",
                  lambing: "Lambing",
                  fawning: "Fawning",
                };
                const dotColor = DOT_COLORS[obs.type] ?? "#9C8E7A";
                const label = EVENT_LABELS[obs.type] ?? obs.type;

                let subDetail = "";
                if (obs.type === "heat_detection") {
                  subDetail = det.method === "scratch_card" ? "Scratch card" : "Visual";
                } else if (obs.type === "insemination") {
                  subDetail = det.method === "AI" ? "AI" : "Natural service";
                  if (det.bullId) subDetail += ` · ${det.bullId}`;
                } else if (obs.type === "pregnancy_scan") {
                  subDetail = det.result === "pregnant" ? "Pregnant" : det.result === "empty" ? "Empty" : "Uncertain — recheck";
                } else if (obs.type === "calving" || obs.type === "lambing" || obs.type === "fawning") {
                  // Offspring status + tag; wording uses the species copy so
                  // sheep farmers see "Live lamb", game farmers see "Live fawn".
                  subDetail = det.calf_status === "live" || det.offspring_status === "live"
                    ? `Live ${copy.offspring}`
                    : "Stillborn";
                  const tag = det.calf_tag || det.lamb_tag || det.fawn_tag || det.offspring_tag;
                  if (tag) subDetail += ` · ${tag}`;
                }

                return (
                  <div key={obs.id} className="relative flex items-start gap-4 pl-5 py-2 -ml-px">
                    <div
                      className="absolute left-0 top-[11px] w-2.5 h-2.5 rounded-full -translate-x-[6px]"
                      style={{ background: dotColor, border: "2px solid #FFFFFF", boxShadow: `0 0 0 1px ${dotColor}` }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium" style={{ color: "#1C1815" }}>
                          {label}
                        </span>
                        {subDetail && (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full"
                            style={{ background: "rgba(139,105,20,0.1)", color: "#8B6914" }}
                          >
                            {subDetail}
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
                        {formatDate(obs.observedAt)}
                        {obs.animalId && (
                          <>
                            {" · "}
                            <Link
                              href={`/${farmSlug}/admin/animals/${obs.animalId}?tab=reproduction`}
                              className="hover:underline"
                            >
                              {obs.animalId}
                            </Link>
                          </>
                        )}
                        {` · ${campName}`}
                        {obs.loggedBy && ` · ${obs.loggedBy}`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
    </AdminPage>
  );
}
