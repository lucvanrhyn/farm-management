import { notFound } from "next/navigation";
import Link from "next/link";
import AdminNav from "@/components/admin/AdminNav";
import MobKPICard from "@/components/admin/MobKPICard";
import PastureIntelligenceCard from "@/components/admin/PastureIntelligenceCard";
import CampCoverForm from "@/components/admin/CampCoverForm";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import type { AnimalCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

const CATEGORY_ORDER: AnimalCategory[] = ["Cow", "Bull", "Heifer", "Calf", "Ox"];
const CATEGORY_LABELS: Record<AnimalCategory, string> = {
  Cow: "Cows",
  Bull: "Bulls",
  Heifer: "Heifers",
  Calf: "Calves",
  Ox: "Oxen",
};

function daysSinceLabel(days: number | null): string {
  if (days === null) return "Never inspected";
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 week ago";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

function inspectionStatus(days: number | null): "good" | "warning" | "alert" {
  if (days === null) return "alert";
  if (days <= 7) return "good";
  if (days <= 14) return "warning";
  return "alert";
}

function healthStatus(rate: number): "good" | "warning" | "alert" {
  if (rate === 0) return "good";
  if (rate <= 0.5) return "warning";
  return "alert";
}

export default async function CampDetailPage({
  params,
}: {
  params: Promise<{ farmSlug: string; campId: string }>;
}) {
  const { farmSlug, campId } = await params;
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    return (
      <div className="flex min-h-screen bg-[#FAFAF8] items-center justify-center">
        <p className="text-red-500 text-sm">Farm not found.</p>
      </div>
    );
  }

  const camp = await prisma.camp.findUnique({ where: { campId } });
  if (!camp) notFound();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const thisMonthStart = new Date();
  thisMonthStart.setDate(1);
  thisMonthStart.setHours(0, 0, 0, 0);

  // Parallel data fetching
  const [activeAnimals, healthCount, calvingCount, visitCount, latestInspection, latestCondition, latestCoverReading] =
    await Promise.all([
      prisma.animal.findMany({
        where: { currentCamp: campId, status: "Active" },
        select: { category: true },
      }),
      prisma.observation.count({
        where: { campId, type: "health_issue", observedAt: { gte: thirtyDaysAgo } },
      }),
      prisma.observation.count({
        where: {
          campId,
          type: { in: ["reproduction", "calving"] as string[] },
          observedAt: { gte: thisMonthStart },
        },
      }),
      prisma.observation.count({
        where: {
          campId,
          type: { in: ["camp_check", "camp_condition"] },
          observedAt: { gte: thirtyDaysAgo },
        },
      }),
      prisma.observation.findFirst({
        where: { campId, type: { in: ["camp_check", "camp_condition"] } },
        orderBy: { observedAt: "desc" },
        select: { observedAt: true, loggedBy: true },
      }),
      prisma.observation.findFirst({
        where: { campId, type: "camp_condition" },
        orderBy: { observedAt: "desc" },
        select: { details: true, observedAt: true },
      }),
      prisma.campCoverReading.findFirst({
        where: { campId },
        orderBy: { recordedAt: "desc" },
      }),
    ]);

  // Category breakdown
  const byCategory: Partial<Record<AnimalCategory, number>> = {};
  for (const a of activeAnimals) {
    const cat = a.category as AnimalCategory;
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
  }

  const animalCount = activeAnimals.length;
  const animalDays = animalCount * 30;
  const healthRate =
    animalCount > 0 && healthCount > 0
      ? parseFloat(((healthCount / animalDays) * 100).toFixed(2))
      : 0;

  const daysSince = latestInspection
    ? Math.floor((Date.now() - new Date(latestInspection.observedAt).getTime()) / 86_400_000)
    : null;

  let conditionDetails: Record<string, string> = {};
  if (latestCondition) {
    try {
      conditionDetails = JSON.parse(latestCondition.details);
    } catch {
      // malformed — ignore
    }
  }

  // Recent observations for timeline (last 10)
  const recentObs = await prisma.observation.findMany({
    where: { campId },
    orderBy: { observedAt: "desc" },
    take: 10,
    select: { id: true, type: true, observedAt: true, loggedBy: true, animalId: true },
  });

  const OBS_LABELS: Record<string, string> = {
    health_issue: "🏥 Health issue",
    animal_movement: "🚚 Animal movement",
    reproduction: "🐄 Reproduction",
    calving: "🐄 Calving",
    death: "💀 Death",
    treatment: "💉 Treatment",
    camp_check: "✅ Camp check",
    camp_condition: "📋 Camp condition",
  };

  return (
    <div className="flex min-h-screen bg-[#FAFAF8]">
      <AdminNav />
      <main className="flex-1 p-8 max-w-4xl">
        {/* Back */}
        <Link
          href={`/${farmSlug}/admin/camps`}
          className="inline-flex items-center gap-1 text-sm mb-6 transition-opacity hover:opacity-70"
          style={{ color: "#9C8E7A" }}
        >
          ← Back to Camps
        </Link>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold" style={{ color: "#1C1815" }}>
            {camp.campName}
          </h1>
          <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
            {[
              camp.sizeHectares ? `${camp.sizeHectares} ha` : null,
              camp.waterSource ? camp.waterSource : null,
            ]
              .filter(Boolean)
              .join(" · ") || "Camp performance overview"}
          </p>
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {/* Animal count */}
          <MobKPICard
            label="Animals in camp"
            value={animalCount}
            sub={
              CATEGORY_ORDER.filter((c) => byCategory[c])
                .map((c) => `${byCategory[c]} ${CATEGORY_LABELS[c]}`)
                .join(" · ") || "No active animals"
            }
            status={animalCount > 0 ? "neutral" : "neutral"}
            icon="🐄"
          />

          {/* Health events */}
          <MobKPICard
            label="Health events (30 days)"
            value={healthCount}
            sub={`${healthRate} events per 100 animal-days`}
            status={healthStatus(healthRate)}
            icon="🏥"
            detail={
              healthCount === 0
                ? "No issues recorded"
                : healthRate <= 0.5
                ? "Low — within normal range"
                : "High — review herd health"
            }
          />

          {/* Last inspection */}
          <MobKPICard
            label="Last inspection"
            value={daysSince !== null ? `${daysSince}d ago` : "—"}
            sub={
              latestInspection?.loggedBy
                ? `By ${latestInspection.loggedBy}`
                : "No inspection recorded"
            }
            status={inspectionStatus(daysSince)}
            icon="🔍"
            detail={
              daysSince === null
                ? "Never inspected"
                : daysSince <= 7
                ? "Up to date"
                : daysSince <= 14
                ? "Due for inspection"
                : "Overdue — inspect soon"
            }
          />

          {/* Camp visits */}
          <MobKPICard
            label="Camp visits (30 days)"
            value={visitCount}
            sub="Check-ins + condition reports"
            status={visitCount >= 4 ? "good" : visitCount >= 2 ? "warning" : "alert"}
            icon="📋"
            detail={
              visitCount === 0
                ? "No visits recorded"
                : visitCount >= 4
                ? "Good activity"
                : "Low — aim for weekly visits"
            }
          />

          {/* Calvings this month */}
          <MobKPICard
            label="Calvings this month"
            value={calvingCount}
            sub={new Date().toLocaleString("en-ZA", { month: "long", year: "numeric" })}
            status={calvingCount > 0 ? "good" : "neutral"}
            icon="🐮"
          />

          {/* Last condition */}
          <MobKPICard
            label="Last camp condition"
            value={
              conditionDetails.grazing
                ? (conditionDetails.grazing as string)
                : "—"
            }
            sub={[
              conditionDetails.water ? `Water: ${conditionDetails.water}` : null,
              conditionDetails.fence ? `Fence: ${conditionDetails.fence}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "No condition data"}
            status={
              !conditionDetails.grazing
                ? "neutral"
                : conditionDetails.grazing === "Good" || conditionDetails.grazing === "Excellent"
                ? "good"
                : conditionDetails.grazing === "Fair"
                ? "warning"
                : "alert"
            }
            icon="🌿"
          />
        </div>

        {/* Pasture Intelligence */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold mb-3" style={{ color: "#1C1815" }}>
            Pasture Intelligence
          </h2>
          <div className="space-y-4">
            <PastureIntelligenceCard
              latest={latestCoverReading}
              sizeHectares={camp.sizeHectares}
              animalCount={animalCount}
            />
            <div
              className="rounded-2xl border p-5"
              style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
            >
              <p className="text-xs font-semibold mb-3" style={{ color: "#6B5E50" }}>
                Record New Cover Reading
              </p>
              <CampCoverForm
                farmSlug={farmSlug}
                campId={campId}
                sizeHectares={camp.sizeHectares}
                animalCount={animalCount}
              />
            </div>
          </div>
        </div>

        {/* Recent activity timeline */}
        <div
          className="rounded-2xl border p-6"
          style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
        >
          <h2 className="text-sm font-semibold mb-4" style={{ color: "#1C1815" }}>
            Recent Activity
          </h2>
          {recentObs.length === 0 ? (
            <p className="text-sm" style={{ color: "#9C8E7A" }}>
              No observations recorded yet.
            </p>
          ) : (
            <ol className="space-y-3">
              {recentObs.map((obs) => {
                const date = new Date(obs.observedAt).toLocaleDateString("en-ZA", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                });
                return (
                  <li key={obs.id} className="flex items-start gap-3 text-sm">
                    <span className="text-base leading-tight mt-0.5 shrink-0">
                      {(OBS_LABELS[obs.type] ?? "📌 " + obs.type).split(" ")[0]}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium" style={{ color: "#1C1815" }}>
                        {OBS_LABELS[obs.type]?.replace(/^[^ ]+ /, "") ??
                          obs.type.replace(/_/g, " ")}
                        {obs.animalId && (
                          <span style={{ color: "#9C8E7A" }}>
                            {" "}
                            ·{" "}
                            <Link
                              href={`/${farmSlug}/admin/animals/${obs.animalId}`}
                              className="hover:underline font-mono"
                            >
                              {obs.animalId}
                            </Link>
                          </span>
                        )}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
                        {date}
                        {obs.loggedBy && ` · ${obs.loggedBy}`}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </main>
    </div>
  );
}
