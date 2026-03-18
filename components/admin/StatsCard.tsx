interface StatsCardProps {
  label: string;
  value: number | string;
  sub?: string;
  color?: "green" | "blue" | "amber" | "red" | "purple";
  icon?: string;
}

const colorBar: Record<NonNullable<StatsCardProps["color"]>, string> = {
  green:  "bg-green-500",
  blue:   "bg-blue-500",
  amber:  "bg-amber-500",
  red:    "bg-red-500",
  purple: "bg-purple-500",
};

export default function StatsCard({ label, value, sub, color = "green", icon }: StatsCardProps) {
  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
      <div className={`h-1 ${colorBar[color]}`} />
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-stone-500 font-medium uppercase tracking-wide">{label}</p>
            <p className="text-2xl font-bold text-stone-800 mt-0.5 font-mono">{value}</p>
            {sub && <p className="text-xs text-stone-400 mt-0.5">{sub}</p>}
          </div>
          {icon && (
            <span className="text-xl opacity-50">{icon}</span>
          )}
        </div>
      </div>
    </div>
  );
}
