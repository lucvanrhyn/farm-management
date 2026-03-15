import AdminNav from "@/components/admin/AdminNav";
import StatsCard from "@/components/admin/StatsCard";
import { prisma } from "@/lib/prisma";
import { CAMPS } from "@/lib/dummy-data";
import {
  getLatestCampConditions,
  getRecentHealthObservations,
  countHealthIssuesSince,
  countInspectedToday,
} from "@/lib/server/camp-status";

export default async function AdminPage() {
  const totalAnimals = await prisma.animal.count({ where: { status: "Active" } });
  const totalCamps = CAMPS.length;

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
    <div className="flex min-h-screen bg-stone-50">
      <AdminNav active="/admin" />
      <main className="flex-1 p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-stone-800">Bedryfsoorsig</h1>
          <p className="text-stone-500 text-sm mt-1">{new Date().toISOString().split("T")[0]} · Brangus Plaasbestuur</p>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-10">
          <StatsCard label="Totale Diere" value={totalAnimals.toLocaleString()} sub="Aktiewe rekords" color="green" icon="🐄" />
          <StatsCard label="Totale Kampe" value={totalCamps} sub="19 kampe op die plaas" color="blue" icon="🌿" />
          <StatsCard label="Inspeksies Vandag" value={`${inspectedToday} / ${totalCamps}`} sub="Kampe gekontroleer" color="amber" icon="✅" />
          <StatsCard label="Gesondheidsprobleme" value={healthIssuesThisWeek} sub="Hierdie week aangeteken" color={healthIssuesThisWeek > 3 ? "red" : "green"} icon="🏥" />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
            <h2 className="font-semibold text-stone-700 mb-4">Onlangse Gesondheidsinsidente</h2>
            {recentHealth.length === 0 ? (
              <p className="text-sm text-stone-400">Geen gesondheidsinsidente aangeteken nie.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {recentHealth.map((obs) => (
                  <div key={obs.id} className="flex items-start gap-3 py-2 border-b border-stone-50 last:border-0">
                    <div className="w-2 h-2 rounded-full bg-red-400 mt-2 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-stone-700">
                        {obs.animalId ?? "Onbekend"} · Kamp {obs.campId}
                      </p>
                      <p className="text-xs text-stone-500">
                        {Array.isArray(obs.details.symptoms) ? obs.details.symptoms.join(", ") : "Gesondheidsprobleem"}
                        {" · "}
                        {obs.observedAt.split("T")[0]}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
            <h2 className="font-semibold text-stone-700 mb-4">Kamp Status Opsomming</h2>
            <div className="flex flex-col gap-2">
              {[
                { label: "Goeie beweiding (Good)", quality: "Good", color: "bg-green-500" },
                { label: "Redelike beweiding (Fair)", quality: "Fair", color: "bg-yellow-500" },
                { label: "Swak beweiding (Poor)", quality: "Poor", color: "bg-orange-500" },
                { label: "Oorbevolk (Overgrazed)", quality: "Overgrazed", color: "bg-red-500" },
              ].map(({ label, quality, color }) => (
                <div key={quality} className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${color} shrink-0`} />
                  <span className="text-sm text-stone-600 flex-1">{label}</span>
                  <span className="text-sm font-semibold text-stone-700">{grazingCounts[quality] ?? 0} kampe</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
