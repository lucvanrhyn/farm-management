import type { OverdueCensusRow } from "@/lib/species/game/analytics";

function StatusBadge({ row }: { row: OverdueCensusRow }) {
  const never = row.daysSinceLastCensus === null;
  const isRed = never || row.daysSinceLastCensus! > 365;

  const label = never
    ? "Never censused"
    : `${row.daysSinceLastCensus} days ago`;

  const style = isRed
    ? { background: "rgba(220,38,38,0.1)", color: "var(--ft-crit)" }
    : { background: "rgba(245,158,11,0.12)", color: "var(--ft-fair)" };

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
        style={{ background: "var(--ft-surface)", borderColor: "var(--ft-border)" }}
      >
        <div className="px-5 py-4 border-b" style={{ borderColor: "var(--ft-border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--ft-text)" }}>
            Overdue Census
          </h2>
        </div>
        <p className="px-5 py-5 text-sm" style={{ color: "var(--ft-subtle)" }}>
          All species are up to date.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: "var(--ft-surface)", borderColor: "var(--ft-border)" }}
    >
      <div className="px-5 py-4 border-b" style={{ borderColor: "var(--ft-border)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--ft-text)" }}>
          Overdue Census
        </h2>
        <p className="text-xs mt-0.5" style={{ color: "var(--ft-subtle)" }}>
          Species needing a new count
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--ft-border)" }}>
              {["Species", "Status"].map((h) => (
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
