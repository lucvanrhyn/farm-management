// KPI summary cards for the Rotation tab.

interface Counts {
  grazing: number;
  overstayed: number;
  resting: number;
  restingReady: number;
  overdueRest: number;
  unknown: number;
}

function KpiCard({
  label,
  value,
  color,
  bg,
  pulse,
}: {
  label: string;
  value: number;
  color: string;
  bg: string;
  pulse?: boolean;
}) {
  return (
    <div
      className="rounded-2xl border p-5 flex flex-col gap-1"
      style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
        {label}
      </p>
      <div className="flex items-baseline gap-2">
        <p className="text-3xl font-bold tabular-nums" style={{ color }}>
          {value}
        </p>
        {pulse && value > 0 && (
          <span
            className="inline-block rounded-full"
            style={{ width: 8, height: 8, background: color, animation: "ping 1.5s cubic-bezier(0,0,0.2,1) infinite" }}
          />
        )}
      </div>
      <p className="text-xs mt-0.5 px-2 py-0.5 rounded-full w-fit" style={{ background: bg, color }}>
        camps
      </p>
    </div>
  );
}

export default function RotationKpiCards({ counts }: { counts: Counts }) {
  const overstayedColor = counts.overstayed > 0 ? "#dc2626" : "#166534";
  const overstayedBg    = counts.overstayed > 0 ? "rgba(220,38,38,0.1)" : "rgba(22,163,74,0.1)";

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <KpiCard
        label="Grazing"
        value={counts.grazing}
        color="#3b82f6"
        bg="rgba(59,130,246,0.1)"
      />
      <KpiCard
        label="Overstayed"
        value={counts.overstayed}
        color={overstayedColor}
        bg={overstayedBg}
        pulse
      />
      <KpiCard
        label="Ready to Graze"
        value={counts.restingReady + counts.overdueRest}
        color="#16a34a"
        bg="rgba(22,163,74,0.1)"
      />
      <KpiCard
        label="Resting"
        value={counts.resting}
        color="#9C8E7A"
        bg="rgba(156,142,122,0.1)"
      />
    </div>
  );
}
