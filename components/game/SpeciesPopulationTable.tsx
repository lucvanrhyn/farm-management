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
        style={{ background: "var(--ft-surface)", borderColor: "var(--ft-border)" }}
      >
        <div className="px-5 py-4 border-b" style={{ borderColor: "var(--ft-border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--ft-text)" }}>
            Population by Species
          </h2>
        </div>
        <p className="px-5 py-5 text-sm" style={{ color: "var(--ft-subtle)" }}>
          No census data recorded yet.
        </p>
      </div>
    );
  }

  const totalPop = species.reduce((sum, s) => sum + s.totalCount, 0);

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: "var(--ft-surface)", borderColor: "var(--ft-border)" }}
    >
      <div className="px-5 py-4 border-b" style={{ borderColor: "var(--ft-border)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--ft-text)" }}>
          Population by Species
        </h2>
        <p className="text-xs mt-0.5" style={{ color: "var(--ft-subtle)" }}>
          Latest census results
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--ft-border)" }}>
              {["Species", "Male", "Female", "Juvenile", "Total"].map((h) => (
                <th
                  key={h}
                  className="px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-wide"
                  style={{ color: "var(--ft-subtle)" }}
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
                <td className="px-5 py-2.5 font-medium" style={{ color: "var(--ft-text)" }}>
                  {s.commonName}
                </td>
                <td className="px-5 py-2.5 tabular-nums" style={{ color: "var(--ft-muted)" }}>
                  {s.maleCount}
                </td>
                <td className="px-5 py-2.5 tabular-nums" style={{ color: "var(--ft-muted)" }}>
                  {s.femaleCount}
                </td>
                <td className="px-5 py-2.5 tabular-nums" style={{ color: "var(--ft-muted)" }}>
                  {s.juvenileCount}
                </td>
                <td className="px-5 py-2.5 font-bold tabular-nums" style={{ color: "var(--ft-text)" }}>
                  {s.totalCount}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: "1px solid var(--ft-border)" }}>
              <td className="px-5 py-2.5 font-semibold" style={{ color: "var(--ft-text)" }}>
                Total
              </td>
              <td colSpan={3} />
              <td className="px-5 py-2.5 font-bold tabular-nums" style={{ color: "var(--ft-text)" }}>
                {totalPop}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
