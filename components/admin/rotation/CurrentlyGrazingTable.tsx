// Table of camps currently being grazed (includes overstayed).

import type { CampRotationStatus } from "@/lib/server/rotation-engine";

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min((value / Math.max(max, 1)) * 100, 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 rounded-full h-1.5" style={{ background: "rgba(0,0,0,0.08)" }}>
        <div
          className="h-1.5 rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-xs tabular-nums whitespace-nowrap" style={{ color: "#9C8E7A" }}>
        {value}d / {max}d
      </span>
    </div>
  );
}

export default function CurrentlyGrazingTable({
  camps,
}: {
  camps: CampRotationStatus[];
}) {
  const rows = camps.filter((c) => c.status === "grazing" || c.status === "overstayed");

  return (
    <div className="rounded-2xl border overflow-hidden mb-6" style={{ borderColor: "#E0D5C8" }}>
      <div className="px-5 py-3 border-b" style={{ background: "#FAFAF8", borderColor: "#E0D5C8" }}>
        <h3 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
          Currently Grazing
        </h3>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b" style={{ borderColor: "#F0EAE0" }}>
            <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>Camp</th>
            <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>Mob(s)</th>
            <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>Days Grazed</th>
            <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>LSU</th>
            <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wide hidden md:table-cell" style={{ color: "#9C8E7A" }}>Size</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-5 py-6 text-center text-sm" style={{ color: "#9C8E7A" }}>
                No camps currently being grazed.
              </td>
            </tr>
          )}
          {rows.map((camp) => {
            const isOverstayed = camp.status === "overstayed";
            const barColor = isOverstayed ? "#dc2626" : "#3b82f6";
            return (
              <tr key={camp.campId} className="border-b last:border-0" style={{ borderColor: "#F0EAE0" }}>
                <td className="px-5 py-3 font-medium" style={{ color: "#1C1815" }}>
                  <div className="flex items-center gap-2">
                    {camp.campName}
                    {isOverstayed && (
                      <span
                        className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold"
                        style={{ background: "rgba(220,38,38,0.12)", color: "#dc2626" }}
                      >
                        ! Overstayed
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-5 py-3" style={{ color: "#4B3D2E" }}>
                  {camp.currentMobs.length === 0 ? (
                    <span style={{ color: "#9C8E7A" }}>—</span>
                  ) : (
                    camp.currentMobs.map((m) => m.mobName).join(", ")
                  )}
                </td>
                <td className="px-5 py-3" style={{ minWidth: 160 }}>
                  {camp.daysGrazed != null ? (
                    <ProgressBar
                      value={camp.daysGrazed}
                      max={camp.effectiveMaxGrazingDays}
                      color={barColor}
                    />
                  ) : (
                    <span style={{ color: "#9C8E7A" }}>—</span>
                  )}
                </td>
                <td className="px-5 py-3 text-right tabular-nums" style={{ color: "#4B3D2E" }}>
                  {camp.totalLsu.toFixed(1)}
                </td>
                <td className="px-5 py-3 text-right hidden md:table-cell" style={{ color: "#9C8E7A" }}>
                  {camp.sizeHectares != null ? `${camp.sizeHectares} ha` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
