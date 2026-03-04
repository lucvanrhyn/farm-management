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
      <div className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-stone-500 font-medium">{label}</p>
            <p className="text-3xl font-bold text-stone-800 mt-1">{value}</p>
            {sub && <p className="text-xs text-stone-400 mt-1">{sub}</p>}
          </div>
          {icon && (
            <span className="text-2xl opacity-60">{icon}</span>
          )}
        </div>
      </div>
    </div>
  );
}
