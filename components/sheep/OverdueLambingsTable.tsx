import type { UpcomingBirth } from "@/lib/species/types";

const GESTATION_DAYS = 150;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function OverdueLambingsTable({
  births,
}: {
  births: UpcomingBirth[];
}) {
  // daysAway < 0 means overdue; sort most overdue first (most negative first)
  const overdue = births
    .filter((b) => b.daysAway < 0)
    .sort((a, b) => a.daysAway - b.daysAway);

  return (
    <div
      className="rounded-2xl border flex flex-col"
      style={{ background: "var(--ft-surface)", borderColor: "var(--ft-border)" }}
    >
      <div className="px-5 py-4 border-b" style={{ borderColor: "var(--ft-border)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--ft-text)" }}>
          Overdue Lambings
        </h2>
        <p className="text-xs mt-0.5" style={{ color: "var(--ft-subtle)" }}>
          &gt;160 days since joining · no lambing recorded
        </p>
      </div>

      {overdue.length === 0 ? (
        <p className="px-5 py-5 text-sm font-medium" style={{ color: "var(--ft-good)" }}>
          No overdue lambings — all on track.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-xs font-semibold uppercase tracking-wide"
                style={{ color: "var(--ft-subtle)", borderBottom: "1px solid var(--ft-border)" }}
              >
                <th className="px-5 py-3 text-left">Ewe ID</th>
                <th className="px-4 py-3 text-left">Camp</th>
                <th className="px-4 py-3 text-left">Joined</th>
                <th className="px-4 py-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {overdue.map((b) => {
                // expectedDate = joiningDate + GESTATION_DAYS, so joiningDate = expectedDate - GESTATION_DAYS
                const joinedDate = new Date(
                  b.expectedDate.getTime() - GESTATION_DAYS * MS_PER_DAY,
                );
                const daysOverdue = Math.abs(b.daysAway);

                return (
                  <tr
                    key={b.animalId}
                    className="border-b last:border-0"
                    style={{ borderColor: "var(--ft-surface2)" }}
                  >
                    <td className="px-5 py-3">
                      <span className="font-mono font-semibold" style={{ color: "var(--ft-text)" }}>
                        {b.animalId}
                      </span>
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--ft-muted)" }}>
                      {b.campName}
                    </td>
                    <td className="px-4 py-3 tabular-nums" style={{ color: "var(--ft-muted)" }}>
                      {formatDate(joinedDate)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className="text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(220,38,38,0.1)", color: "var(--ft-crit)" }}
                      >
                        {daysOverdue}d overdue
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
