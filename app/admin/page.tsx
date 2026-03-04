import AdminNav from "@/components/admin/AdminNav";
import StatsCard from "@/components/admin/StatsCard";
import { getTotalAnimals, getInspectedToday } from "@/lib/utils";
import { CAMPS, OBSERVATIONS } from "@/lib/dummy-data";

export default function AdminPage() {
  const totalAnimals = getTotalAnimals();
  const totalCamps = CAMPS.length;
  const inspectedToday = getInspectedToday();
  const healthIssuesThisWeek = OBSERVATIONS.filter(
    (o) => o.type === "health_issue" && o.timestamp >= "2026-02-21"
  ).length;

  return (
    <div className="flex min-h-screen bg-stone-50">
      <AdminNav active="/admin" />
      <main className="flex-1 p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-stone-800">Bedryfsoorsig</h1>
          <p className="text-stone-500 text-sm mt-1">2026-02-27 · Brangus Plaasbestuur</p>
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
            <div className="flex flex-col gap-3">
              {OBSERVATIONS.filter((o) => o.type === "health_issue")
                .slice(0, 8)
                .map((obs) => {
                  const details = obs.details ? JSON.parse(obs.details) : {};
                  return (
                    <div key={obs.observation_id} className="flex items-start gap-3 py-2 border-b border-stone-50 last:border-0">
                      <div className="w-2 h-2 rounded-full bg-red-400 mt-2 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-stone-700">
                          {obs.animal_id} · Kamp {obs.camp_id}
                        </p>
                        <p className="text-xs text-stone-500">
                          {Array.isArray(details.symptoms) ? details.symptoms.join(", ") : "Gesondheidsprobleem"} · {obs.timestamp.split("T")[0]}
                        </p>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
            <h2 className="font-semibold text-stone-700 mb-4">Kamp Status Opsomming</h2>
            <div className="flex flex-col gap-2">
              {[
                { label: "Goeie beweiding (Good)", count: 10, color: "bg-green-500" },
                { label: "Redelike beweiding (Fair)", count: 6, color: "bg-yellow-500" },
                { label: "Swak beweiding (Poor)", count: 2, color: "bg-orange-500" },
                { label: "Oorbevolk (Overgrazed)", count: 1, color: "bg-red-500" },
              ].map(({ label, count, color }) => (
                <div key={label} className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${color} shrink-0`} />
                  <span className="text-sm text-stone-600 flex-1">{label}</span>
                  <span className="text-sm font-semibold text-stone-700">{count} kampe</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
