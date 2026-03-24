import Link from "next/link";
import AdminNav from "@/components/admin/AdminNav";
import DangerZone from "@/components/admin/DangerZone";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import {
  getLatestCampConditions,
  getRecentHealthObservations,
  countHealthIssuesSince,
  countInspectedToday,
} from "@/lib/server/camp-status";
import { PawPrint, Tent, ClipboardCheck, HeartPulse } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    return (
      <div className="flex min-h-screen bg-[#FAFAF8] items-center justify-center">
        <p className="text-red-500">Farm not found.</p>
      </div>
    );
  }

  const [totalAnimals, totalCamps] = await Promise.all([
    prisma.animal.count({ where: { status: "Active" } }),
    prisma.camp.count(),
  ]);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [healthIssuesThisWeek, inspectedToday, recentHealth, liveConditions] = await Promise.all([
    countHealthIssuesSince(prisma, sevenDaysAgo),
    countInspectedToday(prisma),
    getRecentHealthObservations(prisma, 8),
    getLatestCampConditions(prisma),
  ]);

  // Tally camps by grazing quality from live Prisma data
  // Fall back to hardcoded counts if no Prisma records exist
  const grazingCounts: Record<string, number> = { Good: 0, Fair: 0, Poor: 0, Overgrazed: 0 };
  if (liveConditions.size > 0) {
    for (const status of liveConditions.values()) {
      grazingCounts[status.grazing_quality] = (grazingCounts[status.grazing_quality] ?? 0) + 1;
    }
    // Camps with no recorded condition default to "Fair"
    const unrecorded = totalCamps - liveConditions.size;
    if (unrecorded > 0) grazingCounts["Fair"] = (grazingCounts["Fair"] ?? 0) + unrecorded;
  } else {
    // No Prisma data yet — show zeros so it's obvious, not misleading hardcoded values
    grazingCounts.Good = 0;
    grazingCounts.Fair = totalCamps;
    grazingCounts.Poor = 0;
    grazingCounts.Overgrazed = 0;
  }

  return (
    <div className="flex min-h-screen bg-[#FAFAF8]">
      <AdminNav />
      <main className="flex-1 min-w-0 p-4 md:p-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-[#1C1815]">Operations Overview</h1>
          <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>{new Date().toISOString().split("T")[0]} · Farm Management</p>
        </div>

        {/* Connected stats bar — Delivoice pattern */}
        <div
          className="rounded-2xl overflow-hidden mb-8"
          style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
        >
          <div className="grid grid-cols-2 sm:grid-cols-4">
            {[
              {
                icon: PawPrint,
                iconColor: "#4A7C59",
                badge: "Active",
                badgeColor: "rgba(74,124,89,0.15)",
                badgeText: "#4A7C59",
                value: totalAnimals.toLocaleString(),
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
            ].map(({ icon: Icon, iconColor, badge, badgeColor, badgeText, value, label, href }, i) => (
              <Link
                key={label}
                href={href}
                className="block p-3 sm:p-5 transition-colors hover:bg-[#F5F2EE]"
                style={{
                  borderRight: i < 3 ? "1px solid rgba(139,105,20,0.12)" : undefined,
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: iconColor }} />
                  <span
                    className="text-[10px] font-semibold rounded-full px-2 py-0.5"
                    style={{ background: badgeColor, color: badgeText }}
                  >
                    {badge}
                  </span>
                </div>
                <p className="text-2xl sm:text-3xl font-bold font-mono" style={{ color: "#1C1815" }}>{value}</p>
                <p className="text-xs mt-1" style={{ color: "#9C8E7A" }}>{label}</p>
              </Link>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
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
            {/* Dot matrix — one dot per camp, coloured by grazing quality */}
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
            {/* Legend */}
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
        </div>

        <DangerZone />
      </main>
    </div>
  );
}
