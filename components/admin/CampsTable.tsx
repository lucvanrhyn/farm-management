import Link from "next/link";
import { getLatestCampConditions } from "@/lib/server/camp-status";
import { prisma } from "@/lib/prisma";
import type { Camp } from "@/lib/types";

function grazingColor(g: string): { color: string; bg: string } {
  if (g === "Excellent") return { color: "#4A7C59", bg: "rgba(74,124,89,0.18)" };
  if (g === "Good")      return { color: "#6B9E5E", bg: "rgba(107,158,94,0.15)" };
  if (g === "Poor")      return { color: "#A0522D", bg: "rgba(160,82,45,0.18)" };
  // Fair
  return { color: "#8B6914", bg: "rgba(139,105,20,0.15)" };
}

export default async function CampsTable({ camps }: { camps: Camp[] }) {
  const liveConditions = await getLatestCampConditions();

  const animalCounts = await Promise.all(
    camps.map((camp) =>
      prisma.animal.count({ where: { currentCamp: camp.camp_id, status: "Active" } })
    )
  );
  const countByCamp = new Map(camps.map((camp, i) => [camp.camp_id, animalCounts[i]]));

  return (
    <div
      className="overflow-x-auto rounded-2xl"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <table className="w-full text-sm">
        <thead>
          <tr
            className="text-xs uppercase tracking-wide"
            style={{
              borderBottom: "1px solid #E0D5C8",
              background: "#F5F2EE",
              color: "#9C8E7A",
            }}
          >
            <th className="text-left px-4 py-3 font-semibold">Camp</th>
            <th className="text-right px-4 py-3 font-semibold">Animals</th>
            <th className="text-left px-4 py-3 font-semibold">Water Source</th>
            <th className="text-left px-4 py-3 font-semibold">Last Inspection</th>
            <th className="text-left px-4 py-3 font-semibold">Grazing</th>
            <th className="text-left px-4 py-3 font-semibold">Fence</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {camps.map((camp) => {
            const liveCount = countByCamp.get(camp.camp_id) ?? 0;
            const live = liveConditions.get(camp.camp_id);

            const grazing = live?.grazing_quality ?? "Fair";
            const fence = live?.fence_status ?? "Intact";
            const lastDate = live ? live.last_inspected_at.split("T")[0] : "—";
            const lastBy = live?.last_inspected_by ?? "—";
            const gc = grazingColor(grazing);

            return (
              <tr
                key={camp.camp_id}
                className="admin-row"
                style={{ borderBottom: "1px solid #E0D5C8" }}
              >
                <td className="px-4 py-3 font-semibold" style={{ color: "#1C1815" }}>
                  {camp.camp_name}
                </td>
                <td className="px-4 py-3 text-right font-mono" style={{ color: "#6B5C4E" }}>
                  {liveCount}
                </td>
                <td className="px-4 py-3 capitalize" style={{ color: "#9C8E7A" }}>
                  {camp.water_source ?? "—"}
                </td>
                <td className="px-4 py-3 font-mono text-xs" style={{ color: "#9C8E7A" }}>
                  {lastDate !== "—" ? `${lastDate} · ${lastBy}` : "Never"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
                    style={{ background: gc.bg, color: gc.color }}
                  >
                    {grazing}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
                    style={
                      fence === "Intact"
                        ? { background: "rgba(74,124,89,0.18)", color: "#4A7C59" }
                        : { background: "rgba(139,20,20,0.2)", color: "#C0574C" }
                    }
                  >
                    {fence === "Intact" ? "Intact" : "Damaged"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/camp/${camp.camp_id}`}
                    className="text-xs transition-opacity hover:opacity-70"
                    style={{ color: "#8B6914" }}
                  >
                    View →
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
