import AdminNav from "@/components/admin/AdminNav";
import DangerZone from "@/components/admin/DangerZone";
import { prisma } from "@/lib/prisma";
import {
  getLatestCampConditions,
  getRecentHealthObservations,
  countHealthIssuesSince,
  countInspectedToday,
} from "@/lib/server/camp-status";
import { PawPrint, Tent, ClipboardCheck, HeartPulse } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const [totalAnimals, totalCamps] = await Promise.all([
    prisma.animal.count({ where: { status: "Active" } }),
    prisma.camp.count(),
  ]);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [healthIssuesThisWeek, inspectedToday, recentHealth, liveConditions] = await Promise.all([
    countHealthIssuesSince(sevenDaysAgo),
    countInspectedToday(),
    getRecentHealthObservations(8),
    getLatestCampConditions(),
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
      <AdminNav active="/admin" />
      <main className="flex-1 p-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-[#1C1815]">Operations Overview</h1>
          <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>{new Date().toISOString().split("T")[0]} · Farm Management</p>
        </div>

        {/* Connected stats bar — Delivoice pattern */}
        <div
          className="rounded-2xl overflow-hidden mb-8"
          style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
        >
          <div className="grid grid-cols-4">
            {[
              {
                icon: PawPrint,
                iconColor: "#4A7C59",
                badge: "Active",
                badgeColor: "rgba(74,124,89,0.15)",
                badgeText: "#4A7C59",
                value: totalAnimals.toLocaleString(),
                label: "Total Animals",
              },
              {
                icon: Tent,
                iconColor: "#8B6914",
                badge: "Farm Layout",
                badgeColor: "rgba(139,105,20,0.15)",
                badgeText: "#8B6914",
                value: totalCamps,
                label: "Total Camps",
              },
              {
                icon: ClipboardCheck,
                iconColor: inspectedToday === totalCamps ? "#4A7C59" : "#8B6914",
                badge: `${Math.round((inspectedToday / (totalCamps || 1)) * 100)}% done`,
                badgeColor: inspectedToday === totalCamps ? "rgba(74,124,89,0.15)" : "rgba(139,105,20,0.15)",
                badgeText: inspectedToday === totalCamps ? "#4A7C59" : "#8B6914",
                value: `${inspectedToday}/${totalCamps}`,
                label: "Inspections Today",
              },
              {
                icon: HeartPulse,
                iconColor: healthIssuesThisWeek === 0 ? "#4A7C59" : healthIssuesThisWeek > 3 ? "#8B3A3A" : "#A0522D",
                badge: healthIssuesThisWeek === 0 ? "All clear" : healthIssuesThisWeek > 3 ? "Critical" : "Monitor",
                badgeColor: healthIssuesThisWeek === 0 ? "rgba(74,124,89,0.15)" : healthIssuesThisWeek > 3 ? "rgba(139,58,58,0.15)" : "rgba(160,82,45,0.15)",
                badgeText: healthIssuesThisWeek === 0 ? "#4A7C59" : healthIssuesThisWeek > 3 ? "#8B3A3A" : "#A0522D",
                value: healthIssuesThisWeek,
                label: "Health Issues · 7d",
              },
            ].map(({ icon: Icon, iconColor, badge, badgeColor, badgeText, value, label }, i) => (
              <div
                key={label}
                className="p-5"
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
                <p className="text-3xl font-bold font-mono" style={{ color: "#1C1815" }}>{value}</p>
                <p className="text-xs mt-1" style={{ color: "#9C8E7A" }}>{label}</p>
              </div>
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
              className="text-xs font-semibold uppercase tracking-wide mb-4"
              style={{ color: "#9C8E7A" }}
            >
              Camp Status Summary
            </h2>
            <div className="flex flex-col gap-3">
              {[
                { label: "Good grazing",  quality: "Good",       dot: "#4A7C59" },
                { label: "Fair grazing",  quality: "Fair",       dot: "#8B6914" },
                { label: "Poor grazing",  quality: "Poor",       dot: "#A0522D" },
                { label: "Overgrazed",    quality: "Overgrazed", dot: "#8B3A3A" },
              ].map(({ label, quality, dot }) => {
                const count = grazingCounts[quality] ?? 0;
                const pct = Math.round((count / (totalCamps || 1)) * 100);
                return (
                  <div key={quality}>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />
                      <span className="text-xs flex-1" style={{ color: "#6B5C4E" }}>{label}</span>
                      <span className="text-xs font-mono font-semibold" style={{ color: "#1C1815" }}>{count}</span>
                    </div>
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: "#E0D5C8" }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, background: dot }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <DangerZone />
      </main>
    </div>
  );
}
