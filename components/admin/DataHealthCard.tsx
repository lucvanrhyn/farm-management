import type { DataHealthScore } from "@/lib/server/data-health";

const GRADE_COLORS: Record<string, string> = {
  A: "#4A7C59",
  B: "#8B6914",
  C: "#A0522D",
  D: "#C0574C",
};

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div
      className="w-full rounded-full overflow-hidden"
      style={{ background: "#F0EBE3", height: "6px" }}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.min(100, pct)}%`, background: color }}
      />
    </div>
  );
}

export default function DataHealthCard({ score }: { score: DataHealthScore }) {
  const gradeColor = GRADE_COLORS[score.grade] ?? "#9C8E7A";

  const dimensions = [
    {
      key: "animalsWeighedRecently",
      label: "Animals Weighed",
      hint: "last 30 days",
      pct: score.breakdown.animalsWeighedRecently.pct,
      weight: "40%",
    },
    {
      key: "campsInspectedRecently",
      label: "Camps Inspected",
      hint: "last 7 days",
      pct: score.breakdown.campsInspectedRecently.pct,
      weight: "30%",
    },
    {
      key: "animalsWithCampAssigned",
      label: "Camp Assigned",
      hint: "active animals",
      pct: score.breakdown.animalsWithCampAssigned.pct,
      weight: "20%",
    },
    {
      key: "transactionsThisMonth",
      label: "Transactions",
      hint: "this month",
      pct: score.breakdown.transactionsThisMonth.present ? 100 : 0,
      weight: "10%",
    },
  ] as const;

  return (
    <div
      className="rounded-xl p-4 flex flex-col"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <h2
        className="text-xs font-semibold uppercase tracking-wide mb-3"
        style={{ color: "#9C8E7A" }}
      >
        Data Health
      </h2>

      <div className="flex items-center gap-4 mb-4">
        <span
          className="text-5xl font-black font-mono leading-none"
          style={{ color: gradeColor }}
        >
          {score.grade}
        </span>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs" style={{ color: "#9C8E7A" }}>Overall score</span>
            <span className="text-xs font-mono font-bold" style={{ color: "#1C1815" }}>
              {score.overall}/100
            </span>
          </div>
          <ProgressBar pct={score.overall} color={gradeColor} />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {dimensions.map(({ key, label, hint, pct, weight }) => {
          const dimColor = pct >= 80 ? "#4A7C59" : pct >= 50 ? "#8B6914" : "#C0574C";
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium" style={{ color: "#1C1815" }}>
                    {label}
                  </span>
                  <span className="text-[10px]" style={{ color: "#9C8E7A" }}>
                    {hint}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px]" style={{ color: "#9C8E7A" }}>
                    {weight}
                  </span>
                  <span className="text-xs font-mono font-bold" style={{ color: dimColor }}>
                    {pct}%
                  </span>
                </div>
              </div>
              <ProgressBar pct={pct} color={dimColor} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
