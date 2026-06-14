// Rotation status color legend — shown at the bottom of the Rotation tab.

const LEGEND_ITEMS = [
  { color: "var(--ft-info)", label: "Grazing" },
  { color: "var(--ft-crit)", label: "Overstayed" },
  { color: "var(--ft-good)", label: "Ready to Graze" },
  { color: "#86efac", label: "Resting" },
  { color: "var(--ft-fair)", label: "Overdue Rest" },
  { color: "#9ca3af", label: "Unknown" },
];

export default function RotationLegend() {
  return (
    <div
      className="mt-6 rounded-2xl border p-4 flex flex-wrap items-center gap-4"
      style={{ background: "var(--ft-surface)", borderColor: "var(--ft-border)" }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide mr-2" style={{ color: "var(--ft-subtle)" }}>
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
      <p className="text-xs ml-auto" style={{ color: "var(--ft-subtle)" }}>
        Rotation defaults in{" "}
        <a href="settings" className="underline" style={{ color: "var(--ft-fair)" }}>
          Settings
        </a>
      </p>
    </div>
  );
}
