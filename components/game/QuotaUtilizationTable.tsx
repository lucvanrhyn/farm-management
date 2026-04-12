import type { QuotaUtilizationRow } from "@/lib/species/game/analytics";

function UtilizationBadge({ pct }: { pct: number }) {
  const display = `${Math.round(pct * 100)}%`;

  const style =
    pct > 0.8
      ? { background: "rgba(220,38,38,0.1)", color: "#991B1B" }
      : pct > 0.6
        ? { background: "rgba(245,158,11,0.12)", color: "#92400E" }
        : { background: "rgba(34,197,94,0.1)", color: "#166534" };

  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-medium tabular-nums"
      style={style}
    >
      {display}
    </span>
  );
}

export default function QuotaUtilizationTable({
  quotas,
}: {
  quotas: QuotaUtilizationRow[];
}) {
  if (quotas.length === 0) {
    return (
      <div
        className="rounded-2xl border"
        style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
      >
        <div className="px-5 py-4 border-b" style={{ borderColor: "#E0D5C8" }}>
          <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
            Quota Utilisation
          </h2>
        </div>
        <p className="px-5 py-5 text-sm" style={{ color: "#9C8E7A" }}>
          No offtake quotas configured for this season.
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
          Quota Utilisation
        </h2>
        <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
          Current season offtake quotas
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid #E0D5C8" }}>
              {["Species", "Quota", "Used", "Remaining", "Utilisation"].map(
                (h) => (
                  <th
                    key={h}
                    className="px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-wide"
                    style={{ color: "#9C8E7A" }}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {quotas.map((q) => (
              <tr
                key={q.speciesId}
                style={{ borderBottom: "1px solid rgba(224,213,200,0.5)" }}
              >
                <td className="px-5 py-2.5 font-medium" style={{ color: "#1C1815" }}>
                  {q.speciesId}
                </td>
                <td className="px-5 py-2.5 tabular-nums" style={{ color: "#6B5E50" }}>
                  {q.totalQuota}
                </td>
                <td className="px-5 py-2.5 tabular-nums" style={{ color: "#6B5E50" }}>
                  {q.usedTotal}
                </td>
                <td className="px-5 py-2.5 tabular-nums" style={{ color: "#6B5E50" }}>
                  {q.totalQuota - q.usedTotal}
                </td>
                <td className="px-5 py-2.5">
                  <UtilizationBadge pct={q.utilizationPct} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
