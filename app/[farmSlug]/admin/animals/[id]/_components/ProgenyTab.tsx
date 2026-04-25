// app/[farmSlug]/admin/animals/[id]/_components/ProgenyTab.tsx
// Progeny tab — bulls only. Summary stats, optional quality metrics,
// and a sortable offspring table linked back to each calf's detail page.

import Link from "next/link";
import type { Animal } from "@prisma/client";
import { getCategoryChipColor, getCategoryLabel } from "@/lib/utils";
import type { AnimalCategory } from "@/lib/types";
import { parseDetails } from "./tabs";

type CalvingObs = { animalId: string | null; details: string };

interface ProgenyTabProps {
  offspring: Animal[];
  offspringCalvingObs: CalvingObs[];
  farmSlug: string;
}

export function ProgenyTab({ offspring, offspringCalvingObs, farmSlug }: ProgenyTabProps) {
  const totalOffspring = offspring.length;
  const males = offspring.filter((o) => o.sex === "Male").length;
  const females = offspring.filter((o) => o.sex === "Female").length;
  const alive = offspring.filter((o) => o.status === "Active").length;
  const deceased = offspring.filter((o) => o.status === "Deceased").length;

  // Parse calving obs for birth weights + difficulty
  const calvingDataMap = new Map<string, { birthWeight?: number; difficulty?: number }>();
  for (const obs of offspringCalvingObs) {
    if (!obs.animalId) continue;
    const d = parseDetails(obs.details);
    const entry: { birthWeight?: number; difficulty?: number } = {};
    if (d.birth_weight) entry.birthWeight = parseFloat(String(d.birth_weight));
    if (d.calving_difficulty) entry.difficulty = parseInt(String(d.calving_difficulty), 10);
    calvingDataMap.set(obs.animalId, entry);
  }

  const birthWeights = Array.from(calvingDataMap.values())
    .map((v) => v.birthWeight)
    .filter((w): w is number => w != null && !isNaN(w));
  const avgBirthWeight = birthWeights.length > 0
    ? birthWeights.reduce((a, b) => a + b, 0) / birthWeights.length
    : null;

  const difficulties = Array.from(calvingDataMap.values())
    .map((v) => v.difficulty)
    .filter((d): d is number => d != null && !isNaN(d));
  const avgDifficulty = difficulties.length > 0
    ? difficulties.reduce((a, b) => a + b, 0) / difficulties.length
    : null;

  const liveBorn = offspringCalvingObs.filter((o) => {
    const d = parseDetails(o.details);
    return d.calf_status !== "stillborn";
  }).length;
  const totalCalved = offspringCalvingObs.length;
  const survivalRate = totalCalved > 0 ? (liveBorn / totalCalved) * 100 : null;

  return (
    <div
      className="rounded-2xl border p-5 space-y-5"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
        Progeny ({totalOffspring})
      </h2>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Offspring", value: String(totalOffspring) },
          { label: "Sex Ratio", value: `${males}M / ${females}F` },
          { label: "Active / Deceased", value: `${alive} / ${deceased}` },
          { label: "Avg Birth Weight", value: avgBirthWeight ? `${avgBirthWeight.toFixed(1)} kg` : "No data" },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl p-3" style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}>
            <p className="text-xs" style={{ color: "#9C8E7A" }}>{label}</p>
            <p className="text-lg font-bold font-mono" style={{ color: "#1C1815" }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Quality metrics (when data exists) */}
      {(avgDifficulty !== null || survivalRate !== null) && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {avgDifficulty !== null && (
            <div className="rounded-xl p-3" style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}>
              <p className="text-xs" style={{ color: "#9C8E7A" }}>Avg Calving Difficulty</p>
              <p className="text-lg font-bold font-mono" style={{ color: avgDifficulty <= 2 ? "#4A7C59" : avgDifficulty <= 3 ? "#8B6914" : "#C0574C" }}>
                {avgDifficulty.toFixed(1)} / 5
              </p>
            </div>
          )}
          {survivalRate !== null && (
            <div className="rounded-xl p-3" style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}>
              <p className="text-xs" style={{ color: "#9C8E7A" }}>Calf Survival Rate</p>
              <p className="text-lg font-bold font-mono" style={{ color: survivalRate >= 95 ? "#4A7C59" : survivalRate >= 85 ? "#8B6914" : "#C0574C" }}>
                {survivalRate.toFixed(0)}%
              </p>
            </div>
          )}
        </div>
      )}

      {/* Offspring table */}
      {totalOffspring === 0 ? (
        <p className="text-xs" style={{ color: "#9C8E7A" }}>No offspring recorded.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid #E0D5C8" }}>
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-xs uppercase tracking-wide"
                style={{ borderBottom: "1px solid #E0D5C8", background: "#F5F2EE", color: "#9C8E7A" }}
              >
                <th className="text-left px-3 py-2 font-semibold">Tag</th>
                <th className="text-left px-3 py-2 font-semibold">Name</th>
                <th className="text-left px-3 py-2 font-semibold">Sex</th>
                <th className="text-left px-3 py-2 font-semibold">Category</th>
                <th className="text-left px-3 py-2 font-semibold">DOB</th>
                <th className="text-left px-3 py-2 font-semibold">Camp</th>
                <th className="text-left px-3 py-2 font-semibold">Status</th>
                <th className="text-left px-3 py-2 font-semibold">Dam</th>
              </tr>
            </thead>
            <tbody>
              {offspring.map((calf) => (
                <tr key={calf.id} style={{ borderBottom: "1px solid #E0D5C8" }}>
                  <td className="px-3 py-2">
                    <Link
                      href={`/${farmSlug}/admin/animals/${calf.animalId}`}
                      className="font-mono font-semibold hover:underline"
                      style={{ color: "#4A7C59" }}
                    >
                      {calf.animalId}
                    </Link>
                  </td>
                  <td className="px-3 py-2" style={{ color: "#1C1815" }}>{calf.name ?? "—"}</td>
                  <td className="px-3 py-2" style={{ color: "#6B5C4E" }}>{calf.sex}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getCategoryChipColor(calf.category as AnimalCategory)}`}>
                      {getCategoryLabel(calf.category as AnimalCategory)}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs" style={{ color: "#6B5C4E" }}>
                    {calf.dateOfBirth ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs" style={{ color: "#6B5C4E" }}>{calf.currentCamp}</td>
                  <td className="px-3 py-2">
                    <span
                      className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{
                        background: calf.status === "Active" ? "rgba(74,124,89,0.12)" : calf.status === "Deceased" ? "rgba(192,87,76,0.12)" : "rgba(156,142,122,0.12)",
                        color: calf.status === "Active" ? "#4A7C59" : calf.status === "Deceased" ? "#C0574C" : "#9C8E7A",
                      }}
                    >
                      {calf.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {calf.motherId ? (
                      <Link
                        href={`/${farmSlug}/admin/animals/${calf.motherId}`}
                        className="font-mono text-xs hover:underline"
                        style={{ color: "#4A7C59" }}
                      >
                        {calf.motherId}
                      </Link>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
