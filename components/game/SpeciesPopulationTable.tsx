import type { CensusSpeciesRow } from "@/lib/species/game/analytics";

export default function SpeciesPopulationTable({
  species,
}: {
  species: CensusSpeciesRow[];
}) {
  if (species.length === 0) {
    return (
      <div
        className="rounded-2xl border"
        style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
      >
        <div className="px-5 py-4 border-b" style={{ borderColor: "#E0D5C8" }}>
          <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
            Population by Species
          </h2>
        </div>
        <p className="px-5 py-5 text-sm" style={{ color: "#9C8E7A" }}>
          No census data recorded yet.
        </p>
      </div>
    );
  }

  const totalPop = species.reduce((sum, s) => sum + s.totalCount, 0);

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
    >
      <div className="px-5 py-4 border-b" style={{ borderColor: "#E0D5C8" }}>
        <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
          Population by Species
        </h2>
        <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
          Latest census results
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid #E0D5C8" }}>
              {["Species", "Male", "Female", "Juvenile", "Total"].map((h) => (
                <th
                  key={h}
                  className="px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-wide"
                  style={{ color: "#9C8E7A" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {species.map((s) => (
              <tr
                key={s.speciesId}
                style={{ borderBottom: "1px solid rgba(224,213,200,0.5)" }}
              >
                <td className="px-5 py-2.5 font-medium" style={{ color: "#1C1815" }}>
                  {s.commonName}
                </td>
                <td className="px-5 py-2.5 tabular-nums" style={{ color: "#6B5E50" }}>
                  {s.maleCount}
                </td>
                <td className="px-5 py-2.5 tabular-nums" style={{ color: "#6B5E50" }}>
                  {s.femaleCount}
                </td>
                <td className="px-5 py-2.5 tabular-nums" style={{ color: "#6B5E50" }}>
                  {s.juvenileCount}
                </td>
                <td className="px-5 py-2.5 font-bold tabular-nums" style={{ color: "#1C1815" }}>
                  {s.totalCount}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: "1px solid #E0D5C8" }}>
              <td className="px-5 py-2.5 font-semibold" style={{ color: "#1C1815" }}>
                Total
              </td>
              <td colSpan={3} />
              <td className="px-5 py-2.5 font-bold tabular-nums" style={{ color: "#1C1815" }}>
                {totalPop}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
