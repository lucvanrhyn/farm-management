import type { UpcomingBirth } from "@/lib/species/types";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function badgeStyle(daysAway: number): { background: string; color: string } {
  if (daysAway <= 7)  return { background: "rgba(220,38,38,0.1)",   color: "#991B1B" };
  if (daysAway <= 14) return { background: "rgba(245,158,11,0.12)", color: "#92400E" };
  return               { background: "rgba(34,197,94,0.1)",         color: "#166534" };
}

export default function UpcomingLambingsTable({
  births,
}: {
  births: UpcomingBirth[];
}) {
  const upcoming = births
    .filter((b) => b.daysAway >= 0)
    .sort((a, b) => a.daysAway - b.daysAway);

  return (
    <div
      className="rounded-2xl border flex flex-col"
      style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
    >
      <div className="px-5 py-4 border-b" style={{ borderColor: "#E0D5C8" }}>
        <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
          Upcoming Lambings
        </h2>
        <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
          Next 90 days · sorted by due date
        </p>
      </div>

      {upcoming.length === 0 ? (
        <p className="px-5 py-5 text-sm" style={{ color: "#9C8E7A" }}>
          No upcoming lambings in the next 90 days.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-xs font-semibold uppercase tracking-wide"
                style={{ color: "#9C8E7A", borderBottom: "1px solid #E0D5C8" }}
              >
                <th className="px-5 py-3 text-left">Ewe ID</th>
                <th className="px-4 py-3 text-left">Camp</th>
                <th className="px-4 py-3 text-left">Expected</th>
                <th className="px-4 py-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((b) => (
                <tr
                  key={b.animalId}
                  className="border-b last:border-0"
                  style={{ borderColor: "#F0EAE0" }}
                >
                  <td className="px-5 py-3">
                    <span className="font-mono font-semibold" style={{ color: "#1C1815" }}>
                      {b.animalId}
                    </span>
                  </td>
                  <td className="px-4 py-3" style={{ color: "#6B5E50" }}>
                    {b.campName}
                  </td>
                  <td className="px-4 py-3 tabular-nums" style={{ color: "#1C1815" }}>
                    {formatDate(b.expectedDate)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className="text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full"
                      style={badgeStyle(b.daysAway)}
                    >
                      {b.daysAway === 0 ? "Today" : `${b.daysAway}d`}
                    </span>
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
