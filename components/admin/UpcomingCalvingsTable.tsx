// components/admin/UpcomingCalvingsTable.tsx
import type { UpcomingCalving } from "@/lib/server/reproduction-analytics";

interface Props {
  calvings: UpcomingCalving[];
}

function getCalvingUrgencyTiers(calvings: UpcomingCalving[]) {
  return {
    overdue: calvings.filter(c => c.daysAway < 0),
    due7d: calvings.filter(c => c.daysAway >= 0 && c.daysAway <= 7),
    due14d: calvings.filter(c => c.daysAway > 7 && c.daysAway <= 14),
    upcoming: calvings.filter(c => c.daysAway > 14),
  };
}

type UrgencyLevel = "overdue" | "7days" | "14days" | "upcoming";

function getUrgency(daysAway: number): UrgencyLevel {
  if (daysAway < 0) return "overdue";
  if (daysAway <= 7) return "7days";
  if (daysAway <= 14) return "14days";
  return "upcoming";
}

function UrgencyBadge({ daysAway }: { daysAway: number }) {
  const level = getUrgency(daysAway);
  const styles: Record<UrgencyLevel, { label: string; bg: string; color: string }> = {
    overdue: {
      label: "OVERDUE",
      bg: "rgba(192,87,76,0.12)",
      color: "var(--ft-poor)",
    },
    "7days": {
      label: "7 days",
      bg: "rgba(139,69,19,0.14)",
      color: "#7B3C00",
    },
    "14days": {
      label: "14 days",
      bg: "rgba(139,105,20,0.12)",
      color: "var(--ft-fair)",
    },
    upcoming: {
      label: "Upcoming",
      bg: "rgba(156,142,122,0.12)",
      color: "var(--ft-subtle)",
    },
  };
  const s = styles[level];
  return (
    <span
      className="text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

function SourceBadge({ source }: { source: "scan" | "insemination" }) {
  if (source === "scan") {
    return (
      <span
        className="text-xs font-medium px-2 py-0.5 rounded-full"
        style={{ background: "rgba(74,124,89,0.10)", color: "var(--ft-good)" }}
      >
        Scan
      </span>
    );
  }
  return (
    <span
      className="text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ background: "rgba(156,142,122,0.12)", color: "var(--ft-muted)" }}
    >
      AI
    </span>
  );
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

export default function UpcomingCalvingsTable({ calvings }: Props) {
  const tiers = getCalvingUrgencyTiers(calvings);
  const sorted = [...calvings].sort((a, b) => a.daysAway - b.daysAway);

  // Summary counts for the header
  const overdueCount = tiers.overdue.length;
  const urgentCount = tiers.due7d.length;

  return (
    <div
      className="rounded-2xl border mb-6"
      style={{ background: "var(--ft-surface)", borderColor: overdueCount > 0 ? "var(--ft-poor)" : urgentCount > 0 ? "var(--ft-fair)" : "var(--ft-border)" }}
    >
      <div className="px-6 py-4 border-b" style={{ borderColor: "var(--ft-border)" }}>
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold" style={{ color: "var(--ft-text)" }}>
            Upcoming Calvings
          </h2>
          {overdueCount > 0 && (
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{ background: "rgba(192,87,76,0.12)", color: "var(--ft-poor)" }}
            >
              {overdueCount} overdue
            </span>
          )}
          {urgentCount > 0 && (
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{ background: "rgba(139,69,19,0.12)", color: "#7B3C00" }}
            >
              {urgentCount} within 7 days
            </span>
          )}
        </div>
        <p className="text-xs mt-0.5" style={{ color: "var(--ft-subtle)" }}>
          Based on scan (preferred) or insemination date + 285-day gestation · next 90 days
        </p>
      </div>

      {sorted.length === 0 ? (
        <p className="px-6 py-5 text-sm" style={{ color: "var(--ft-subtle)" }}>
          No calvings expected in the next 90 days.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-xs font-semibold uppercase tracking-wide"
                style={{ color: "var(--ft-subtle)", borderBottom: "1px solid var(--ft-border)" }}
              >
                <th className="px-6 py-3 text-left">Animal ID</th>
                <th className="px-4 py-3 text-left">Camp</th>
                <th className="px-4 py-3 text-left">Expected Date</th>
                <th className="px-4 py-3 text-right">Days Away</th>
                <th className="px-4 py-3 text-left">Source</th>
                <th className="px-4 py-3 text-left">Urgency</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr
                  key={c.animalId}
                  className="border-b last:border-0"
                  style={{ borderColor: "var(--ft-surface2)" }}
                >
                  <td className="px-6 py-3 font-mono font-semibold" style={{ color: "var(--ft-text)" }}>
                    {c.animalId}
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--ft-muted)" }}>
                    {c.campName}
                  </td>
                  <td className="px-4 py-3 tabular-nums" style={{ color: "var(--ft-text)" }}>
                    {formatDate(c.expectedCalving)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-mono" style={{ color: "var(--ft-text)" }}>
                    {c.daysAway < 0
                      ? <span style={{ color: "var(--ft-poor)" }}>{Math.abs(c.daysAway)}d ago</span>
                      : `${c.daysAway}d`
                    }
                  </td>
                  <td className="px-4 py-3">
                    <SourceBadge source={c.source} />
                  </td>
                  <td className="px-4 py-3">
                    <UrgencyBadge daysAway={c.daysAway} />
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
