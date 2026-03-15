import Link from "next/link";
import { CAMPS } from "@/lib/dummy-data";
import { getCampStats, getLastInspection, getGrazingTailwindBg } from "@/lib/utils";
import { getLatestCampConditions } from "@/lib/server/camp-status";

export default async function CampsTable() {
  const liveConditions = await getLatestCampConditions();

  return (
    <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-100 bg-stone-50">
            <th className="text-left px-4 py-3 font-semibold text-stone-600">Kamp</th>
            <th className="text-right px-4 py-3 font-semibold text-stone-600">Diere</th>
            <th className="text-left px-4 py-3 font-semibold text-stone-600">Waterbroen</th>
            <th className="text-left px-4 py-3 font-semibold text-stone-600">Laaste Inspeksie</th>
            <th className="text-left px-4 py-3 font-semibold text-stone-600">Beweiding</th>
            <th className="text-left px-4 py-3 font-semibold text-stone-600">Heinings</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {CAMPS.map((camp) => {
            const stats = getCampStats(camp.camp_id);
            const lastLog = getLastInspection(camp.camp_id);
            const live = liveConditions.get(camp.camp_id);

            const grazing = live?.grazing_quality ?? lastLog?.grazing_quality ?? "Fair";
            const fence = live?.fence_status ?? lastLog?.fence_status ?? "Intact";
            const lastDate = live
              ? live.last_inspected_at.split("T")[0]
              : lastLog?.date ?? "—";
            const lastBy = live?.last_inspected_by ?? lastLog?.inspected_by ?? "—";

            return (
              <tr key={camp.camp_id} className="border-b border-stone-50 hover:bg-stone-50 transition-colors">
                <td className="px-4 py-3 font-semibold text-stone-800">{camp.camp_name}</td>
                <td className="px-4 py-3 text-right font-mono text-stone-700">{stats.total}</td>
                <td className="px-4 py-3 text-stone-600 capitalize">{camp.water_source ?? "—"}</td>
                <td className="px-4 py-3 text-stone-500">
                  {lastDate !== "—" ? `${lastDate} · ${lastBy}` : "—"}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${getGrazingTailwindBg(grazing)}`}>
                    {grazing}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${fence === "Intact" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                    {fence === "Intact" ? "Heel" : "Beskadig"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/dashboard/camp/${camp.camp_id}`} className="text-xs text-blue-600 hover:underline">
                    Bekyk →
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
