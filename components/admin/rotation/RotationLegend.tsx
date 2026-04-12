// Rotation status color legend — shown at the bottom of the Rotation tab.

const LEGEND_ITEMS = [
  { color: "#3b82f6", label: "Grazing" },
  { color: "#dc2626", label: "Overstayed" },
  { color: "#16a34a", label: "Ready to Graze" },
  { color: "#86efac", label: "Resting" },
  { color: "#f59e0b", label: "Overdue Rest" },
  { color: "#9ca3af", label: "Unknown" },
];

export default function RotationLegend() {
  return (
    <div
      className="mt-6 rounded-2xl border p-4 flex flex-wrap items-center gap-4"
      style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide mr-2" style={{ color: "#9C8E7A" }}>
        Status key
      </p>
      {LEGEND_ITEMS.map(({ color, label }) => (
        <div key={label} className="flex items-center gap-1.5">
          <span
            className="inline-block rounded-full"
            style={{ width: 10, height: 10, background: color, flexShrink: 0 }}
          />
          <span className="text-xs" style={{ color: "#4B3D2E" }}>
            {label}
          </span>
        </div>
      ))}
      <p className="text-xs ml-auto" style={{ color: "#9C8E7A" }}>
        Rotation defaults in{" "}
        <a href="settings" className="underline" style={{ color: "#8B6914" }}>
          Settings
        </a>
      </p>
    </div>
  );
}
