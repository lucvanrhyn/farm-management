import type { OverdueCensusRow } from "@/lib/species/game/analytics";

function StatusBadge({ row }: { row: OverdueCensusRow }) {
  const never = row.daysSinceLastCensus === null;
  const isRed = never || row.daysSinceLastCensus! > 365;

  const label = never
    ? "Never censused"
    : `${row.daysSinceLastCensus} days ago`;

  const style = isRed
    ? { background: "rgba(220,38,38,0.1)", color: "#991B1B" }
    : { background: "rgba(245,158,11,0.12)", color: "#92400E" };

  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={style}
    >
      {label}
    </span>
  );
}

export default function OverdueCensusTable({
  species,
}: {
  species: OverdueCensusRow[];
}) {
  if (species.length === 0) {
    return (
      <div
        className="rounded-2xl border"
        style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
      >
        <div className="px-5 py-4 border-b" style={{ borderColor: "#E0D5C8" }}>
          <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
            Overdue Census
          </h2>
        </div>
        <p className="px-5 py-5 text-sm" style={{ color: "#9C8E7A" }}>
          All species are up to date.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
    >
      <div className="px-5 py-4 border-b" style={{ borderColor: "#E0D5C8" }}>
        <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
          Overdue Census
        </h2>
        <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
          Species needing a new count
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid #E0D5C8" }}>
              {["Species", "Status"].map((h) => (
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
                <td className="px-5 py-2.5">
                  <StatusBadge row={s} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
