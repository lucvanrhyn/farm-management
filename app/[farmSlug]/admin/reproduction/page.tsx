import Link from "next/link";
import AdminNav from "@/components/admin/AdminNav";
import MobKPICard from "@/components/admin/MobKPICard";
import { getPrismaForFarm } from "@/lib/farm-prisma";

export const dynamic = "force-dynamic";

// SA default gestation: 285 days (Bonsmara/Brangus/Nguni range 283–285d; 285 is safe midpoint)
const GESTATION_DAYS = 285;

type ScanResult = "pregnant" | "empty" | "uncertain";

interface ReproObs {
  id: string;
  type: string;
  animalId: string | null;
  campId: string;
  observedAt: Date;
  loggedBy: string | null;
  details: string;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function daysFromNow(date: Date): number {
  return Math.round((date.getTime() - Date.now()) / 86_400_000);
}

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

export default async function ReproductionPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  const prisma = await getPrismaForFarm(farmSlug);

  if (!prisma) {
    return (
      <div className="flex min-h-screen bg-[#FAFAF8] items-center justify-center">
        <p className="text-red-500 text-sm">Farm not found.</p>
      </div>
    );
  }

  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

  // Fetch all repro observations in last 12 months, latest first
  const reproObs: ReproObs[] = await prisma.observation.findMany({
    where: {
      type: { in: ["heat_detection", "insemination", "pregnancy_scan"] },
      observedAt: { gte: twelveMonthsAgo },
    },
    orderBy: { observedAt: "desc" },
    select: {
      id: true,
      type: true,
      animalId: true,
      campId: true,
      observedAt: true,
      loggedBy: true,
      details: true,
    },
  });

  // Fetch all camps for name lookups
  const allCamps = await prisma.camp.findMany({
    select: { campId: true, campName: true },
  });
  const campMap = new Map(allCamps.map((c) => [c.campId, c.campName]));

  // ── KPI calculations ────────────────────────────────────────────────

  // 1. Animals in heat (last 7 days) — unique animal IDs
  const heatAnimalIds = new Set(
    reproObs
      .filter((o) => o.type === "heat_detection" && o.observedAt >= sevenDaysAgo && o.animalId)
      .map((o) => o.animalId as string)
  );

  // 2. Inseminations in last 30 days
  const inseminations30d = reproObs.filter(
    (o) => o.type === "insemination" && o.observedAt >= thirtyDaysAgo
  );

  // 3. All inseminations in last 12 months → expected calving dates
  const allInseminations = reproObs.filter((o) => o.type === "insemination" && o.animalId);

  // Deduplicate: keep only the most recent insemination per animal
  const latestInsemByAnimal = new Map<string, ReproObs>();
  for (const obs of allInseminations) {
    const aid = obs.animalId as string;
    if (!latestInsemByAnimal.has(aid)) {
      latestInsemByAnimal.set(aid, obs);
    }
  }

  // Build upcoming calvings list (expected calving within next 90 days, or up to 7 days overdue)
  const upcomingCalvings = Array.from(latestInsemByAnimal.values())
    .map((obs) => {
      const expectedCalving = addDays(obs.observedAt, GESTATION_DAYS);
      const daysAway = daysFromNow(expectedCalving);
      const det = parseDetails(obs.details);
      return {
        animalId: obs.animalId as string,
        campId: obs.campId,
        campName: campMap.get(obs.campId) ?? obs.campId,
        insemDate: obs.observedAt,
        method: det.method ?? "unknown",
        bullId: det.bullId ?? null,
        expectedCalving,
        daysAway,
      };
    })
    .filter((c) => c.daysAway >= -7 && c.daysAway <= 90)
    .sort((a, b) => a.daysAway - b.daysAway);

  // Expected calvings in next 30 days
  const calvingsDue30d = upcomingCalvings.filter((c) => c.daysAway >= 0 && c.daysAway <= 30).length;

  // 4. Pregnancy scan results — most recent scan per animal
  const scanObs = reproObs.filter((o) => o.type === "pregnancy_scan" && o.animalId);
  const latestScanByAnimal = new Map<string, ReproObs>();
  for (const obs of scanObs) {
    const aid = obs.animalId as string;
    if (!latestScanByAnimal.has(aid)) {
      latestScanByAnimal.set(aid, obs);
    }
  }

  const scanCounts = { pregnant: 0, empty: 0, uncertain: 0 };
  for (const obs of latestScanByAnimal.values()) {
    const det = parseDetails(obs.details);
    const result = (det.result ?? "uncertain") as ScanResult;
    if (result in scanCounts) scanCounts[result]++;
  }

  // Scan conception rate = pregnant / (pregnant + empty) × 100
  const scanTotal = scanCounts.pregnant + scanCounts.empty;
  const conceptionRate = scanTotal > 0 ? Math.round((scanCounts.pregnant / scanTotal) * 100) : null;

  // Recent events (last 15)
  const recentEvents = reproObs.slice(0, 15);

  const EVENT_LABELS: Record<string, string> = {
    heat_detection: "🔥 Heat detected",
    insemination: "💉 Insemination",
    pregnancy_scan: "🔬 Pregnancy scan",
  };

  return (
    <div className="flex min-h-screen bg-[#FAFAF8]">
      <AdminNav />
      <main className="flex-1 p-4 md:p-8 max-w-5xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold" style={{ color: "#1C1815" }}>
            Reproductive Performance
          </h1>
          <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
            {reproObs.length > 0
              ? `${reproObs.length} events recorded · SA target: ≥80% conception rate`
              : "No reproductive events recorded yet — log heat, insemination or scan events via the Logger"}
          </p>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <MobKPICard
            label="In heat (7 days)"
            value={heatAnimalIds.size}
            sub={heatAnimalIds.size === 0 ? "No animals flagged" : "Animals showing oestrus"}
            status={heatAnimalIds.size > 0 ? "warning" : "neutral"}
            icon="🔥"
          />
          <MobKPICard
            label="Inseminations (30 days)"
            value={inseminations30d.length}
            sub={inseminations30d.length === 0 ? "None recorded" : "Services logged"}
            status={inseminations30d.length > 0 ? "good" : "neutral"}
            icon="💉"
          />
          <MobKPICard
            label="Confirmed pregnant"
            value={scanCounts.pregnant}
            sub={
              conceptionRate !== null
                ? `${conceptionRate}% scan conception rate${conceptionRate >= 80 ? " ✓" : " (target ≥80%)"}`
                : "No scans recorded"
            }
            status={
              conceptionRate === null ? "neutral" : conceptionRate >= 80 ? "good" : "warning"
            }
            icon="🔬"
          />
          <MobKPICard
            label="Calvings due (30 days)"
            value={calvingsDue30d}
            sub={
              upcomingCalvings.length === 0
                ? "No inseminations on record"
                : `Based on insemination + ${GESTATION_DAYS}d gestation`
            }
            status={calvingsDue30d > 0 ? "warning" : "neutral"}
            icon="🐮"
          />
        </div>

        {/* Upcoming calvings */}
        <div
          className="rounded-2xl border mb-6"
          style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
        >
          <div className="px-6 py-4 border-b" style={{ borderColor: "#E0D5C8" }}>
            <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
              Expected Calvings
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
              Insemination date + {GESTATION_DAYS} days · showing next 90 days
            </p>
          </div>
          {upcomingCalvings.length === 0 ? (
            <p className="px-6 py-5 text-sm" style={{ color: "#9C8E7A" }}>
              No upcoming calvings calculated. Log insemination events via the Logger to track
              expected calving dates.
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
                    <th className="px-4 py-3 text-left">Inseminated</th>
                    <th className="px-4 py-3 text-left">Method</th>
                    <th className="px-4 py-3 text-left">Expected Calving</th>
                    <th className="px-4 py-3 text-right">Days Away</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingCalvings.map((c) => {
                    const urgency = calvingUrgency(c.daysAway);
                    return (
                      <tr
                        key={c.animalId}
                        className="border-b last:border-0"
                        style={{ borderColor: "#F0EAE0" }}
                      >
                        <td className="px-6 py-3">
                          <Link
                            href={`/${farmSlug}/admin/animals/${c.animalId}`}
                            className="font-mono font-semibold hover:underline"
                            style={{ color: "#1C1815" }}
                          >
                            {c.animalId}
                          </Link>
                        </td>
                        <td className="px-4 py-3" style={{ color: "#6B5E50" }}>
                          {c.campName}
                        </td>
                        <td className="px-4 py-3 tabular-nums" style={{ color: "#6B5E50" }}>
                          {formatDate(c.insemDate)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={
                              c.method === "AI"
                                ? {
                                    backgroundColor: "rgba(139,105,20,0.12)",
                                    color: "#7A5C00",
                                  }
                                : {
                                    backgroundColor: "rgba(92,61,46,0.1)",
                                    color: "#6B5E50",
                                  }
                            }
                          >
                            {c.method === "AI" ? "AI" : c.method === "natural" ? "Natural" : c.method}
                            {c.bullId ? ` · ${c.bullId}` : ""}
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

        {/* Scan results */}
        <div
          className="rounded-2xl border mb-6"
          style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
        >
          <div className="px-6 py-4 border-b" style={{ borderColor: "#E0D5C8" }}>
            <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
              Pregnancy Scan Results
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
              Most recent scan per animal · SA commercial target ≥80% conception rate
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
                  {scanCounts[item.key]}
                </p>
                <p className="text-xs font-medium mt-1" style={{ color: item.color }}>
                  {item.label}
                </p>
              </div>
            ))}
          </div>
          {conceptionRate !== null && (
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
                  conceptionRate >= 80
                    ? { backgroundColor: "rgba(34,197,94,0.1)", color: "#166534" }
                    : { backgroundColor: "rgba(245,158,11,0.12)", color: "#92400E" }
                }
              >
                {conceptionRate}%
              </span>
              <span className="text-xs" style={{ color: "#9C8E7A" }}>
                (target ≥80%)
              </span>
            </div>
          )}
        </div>

        {/* Recent events timeline */}
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
            <div className="px-6 py-4" style={{ borderLeft: "2px solid #E0D5C8", marginLeft: "29px" }}>
              {recentEvents.map((obs) => {
                const det = parseDetails(obs.details);
                const label = EVENT_LABELS[obs.type] ?? obs.type;
                const campName = campMap.get(obs.campId) ?? obs.campId;
                const dotColor = obs.type === "heat_detection" ? "#D47EB5" : obs.type === "insemination" ? "#8B6914" : "#4A7C59";

                let subDetail = "";
                if (obs.type === "heat_detection") {
                  subDetail = det.method === "scratch_card" ? "Scratch card" : "Visual";
                } else if (obs.type === "insemination") {
                  subDetail = det.method === "AI" ? "AI" : "Natural service";
                  if (det.bullId) subDetail += ` · ${det.bullId}`;
                } else if (obs.type === "pregnancy_scan") {
                  subDetail = det.result === "pregnant" ? "Pregnant" : det.result === "empty" ? "Empty" : "Uncertain — recheck";
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
                          {label.replace(/^[^ ]+ /, "")}
                        </span>
                        {subDetail && (
                          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(139,105,20,0.1)", color: "#8B6914" }}>
                            {subDetail}
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
                        {formatDate(obs.observedAt)}
                        {obs.animalId && (
                          <>
                            {" · "}
                            <Link href={`/${farmSlug}/admin/animals/${obs.animalId}`} className="hover:underline">
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
      </main>
    </div>
  );
}
