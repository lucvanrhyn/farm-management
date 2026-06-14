interface StatsCardProps {
  label: string;
  value: number | string;
  sub?: string;
  color?: "green" | "blue" | "amber" | "red" | "purple";
  icon?: string;
}

const colorBar: Record<NonNullable<StatsCardProps["color"]>, string> = {
  green:  "bg-[var(--ft-good)]",
  blue:   "bg-[var(--ft-info)]",
  amber:  "bg-[var(--ft-fair)]",
  red:    "bg-[var(--ft-crit)]",
  purple: "bg-purple-500",
};

export default function StatsCard({ label, value, sub, color = "green", icon }: StatsCardProps) {
  return (
    <div className="bg-[var(--ft-surface)] rounded-2xl border border-[var(--ft-border)] shadow-sm overflow-hidden">
      <div className={`h-1 ${colorBar[color]}`} />
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-[var(--ft-subtle)] font-medium uppercase tracking-wide">{label}</p>
            <p className="text-2xl font-bold text-[var(--ft-text)] mt-0.5 font-mono">{value}</p>
            {sub && <p className="text-xs text-[var(--ft-subtle)] mt-0.5">{sub}</p>}
          </div>
          {icon && (
            <span className="text-xl opacity-50">{icon}</span>
          )}
        </div>
      </div>
    </div>
  );
}
