import type { DataHealthScore } from "@/lib/server/data-health";

const GRADE_COLORS: Record<string, string> = {
  A: "#4A7C59",
  B: "#8B6914",
  C: "#A0522D",
  D: "#C0574C",
};

// Completion thresholds (tuneable grade boundaries, not scoring formula).
// A dimension is "done" when it clears the same 80% target that pushes the
// overall grade into A-territory.
const WEIGHED_DONE_PCT = 70;
const INSPECTED_DONE_PCT = 70;
const ASSIGNED_DONE_PCT = 95;
const CELEBRATE_SCORE = 80;

/**
 * Derive the user-facing "quick win" text for an item based on whether it's
 * currently satisfied. We keep the copy short and point at the concrete next
 * action so a farmer can self-serve from the dashboard card.
 */
interface QuickWin {
  readonly key: string;
  readonly done: boolean;
  /** Headline shown to the user; changes between done/to-do states. */
  readonly text: string;
}

export default function DataHealthCard({ score }: { score: DataHealthScore }) {
  const gradeColor = GRADE_COLORS[score.grade] ?? "#9C8E7A";
  const celebrating = score.overall >= CELEBRATE_SCORE;

  const { breakdown } = score;

  const weighedPct = breakdown.animalsWeighedRecently.pct;
  const inspectedPct = breakdown.campsInspectedRecently.pct;
  const assignedPct = breakdown.animalsWithCampAssigned.pct;
  const txPresent = breakdown.transactionsThisMonth.present;

  // Extract the count of unassigned animals from the existing label, which is
  // the form "{assigned} of {active} active animals have a camp". Falls back
  // gracefully if the label shape ever changes.
  const unassignedMatch = /^(\d+)\s+of\s+(\d+)/.exec(
    breakdown.animalsWithCampAssigned.label,
  );
  const unassignedCount =
    unassignedMatch !== null
      ? Math.max(0, Number(unassignedMatch[2]) - Number(unassignedMatch[1]))
      : null;

  const wins: QuickWin[] = [
    {
      key: "weighed",
      done: weighedPct >= WEIGHED_DONE_PCT,
      text:
        weighedPct >= WEIGHED_DONE_PCT
          ? `Recent weigh-ins (${weighedPct}%)`
          : "Weigh a few animals to unlock trend charts",
    },
    {
      key: "inspected",
      done: inspectedPct >= INSPECTED_DONE_PCT,
      text:
        inspectedPct >= INSPECTED_DONE_PCT
          ? `Camp inspections up to date (${inspectedPct}%)`
          : "Inspect your camps this week (tap a camp tile → Check)",
    },
    {
      key: "assigned",
      done: assignedPct >= ASSIGNED_DONE_PCT,
      text:
        assignedPct >= ASSIGNED_DONE_PCT
          ? "Animals are assigned to camps"
          : unassignedCount !== null && unassignedCount > 0
            ? `Assign animals to camps (${unassignedCount} unassigned)`
            : "Assign animals to camps",
    },
    {
      key: "transactions",
      done: txPresent,
      text: txPresent
        ? "Financial transactions logged this month"
        : "Record your first financial transaction",
    },
  ];

  return (
    <div
      className="rounded-xl p-4 flex flex-col"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <h2
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "#9C8E7A" }}
        >
          {celebrating ? "Data health" : "Quick wins to boost your data"}
        </h2>
        {/* Discreet score badge */}
        <span
          className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
          aria-label={`Data health score ${score.overall} out of 100, grade ${score.grade}`}
          style={{
            color: gradeColor,
            background: "#F5F2EE",
            border: "1px solid #E0D5C8",
          }}
        >
          Score: {score.overall}/100 · {score.grade}
        </span>
      </div>

      {celebrating ? (
        <p className="text-sm" style={{ color: "#1C1815" }}>
          Data health looking good! Keep logging and you&rsquo;ll stay ahead of the curve.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" role="list">
          {wins.map((win) => (
            <li
              key={win.key}
              className="flex items-start gap-2.5 text-sm"
              style={{ color: win.done ? "#6B5E50" : "#1C1815" }}
            >
              {/* Faux-checkbox visual. aria-hidden because the label already
                  conveys state via prefix text below. */}
              <span
                aria-hidden="true"
                className="mt-0.5 shrink-0 w-4 h-4 rounded flex items-center justify-center"
                style={{
                  border: win.done ? "none" : "1.5px solid #C4B8AA",
                  background: win.done ? "#4A7C59" : "transparent",
                  color: "#FFFFFF",
                  fontSize: "10px",
                  lineHeight: 1,
                }}
              >
                {win.done ? "✓" : ""}
              </span>
              <span
                className={win.done ? "line-through" : ""}
                style={{ opacity: win.done ? 0.7 : 1 }}
              >
                <span className="sr-only">{win.done ? "Completed: " : "To do: "}</span>
                {win.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
