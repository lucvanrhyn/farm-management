// Table of camps currently resting (resting, resting_ready, overdue_rest).

import type { CampRotationStatus } from "@/lib/server/rotation-engine";
import type { RotationStatus } from "@/lib/calculators/rotation";

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

const STATUS_CHIP: Record<RotationStatus, { label: string; color: string; bg: string } | null> = {
  resting:       { label: "Resting",       color: "#166534",  bg: "rgba(134,239,172,0.2)" },
  resting_ready: { label: "Ready",          color: "#166534",  bg: "rgba(22,163,74,0.15)" },
  overdue_rest:  { label: "Overdue Rest",   color: "#92400E",  bg: "rgba(245,158,11,0.12)" },
  grazing:       null,
  overstayed:    null,
  unknown:       null,
};

const RESTING_STATUSES: RotationStatus[] = ["resting", "resting_ready", "overdue_rest"];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function barColorForStatus(status: RotationStatus): string {
  if (status === "overdue_rest")  return "#f59e0b";
  if (status === "resting_ready") return "#16a34a";
  return "#86efac";
}

export default function RestingCampsTable({ camps }: { camps: CampRotationStatus[] }) {
  const rows = camps.filter((c) => (RESTING_STATUSES as string[]).includes(c.status));

  return (
    <div className="rounded-2xl border overflow-hidden mb-6" style={{ borderColor: "#E0D5C8" }}>
      <div className="px-5 py-3 border-b" style={{ background: "#FAFAF8", borderColor: "#E0D5C8" }}>
        <h3 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
          Resting Camps
        </h3>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b" style={{ borderColor: "#F0EAE0" }}>
            <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>Camp</th>
            <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>Rest Progress</th>
            <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide hidden md:table-cell" style={{ color: "#9C8E7A" }}>Next Eligible</th>
            <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="px-5 py-6 text-center text-sm" style={{ color: "#9C8E7A" }}>
                No camps currently resting.
              </td>
            </tr>
          )}
          {rows.map((camp) => {
            const chip = STATUS_CHIP[camp.status];
            return (
              <tr key={camp.campId} className="border-b last:border-0" style={{ borderColor: "#F0EAE0" }}>
                <td className="px-5 py-3 font-medium" style={{ color: "#1C1815" }}>
                  {camp.campName}
                </td>
                <td className="px-5 py-3" style={{ minWidth: 160 }}>
                  {camp.daysRested != null ? (
                    <ProgressBar
                      value={camp.daysRested}
                      max={camp.effectiveRestDays}
                      color={barColorForStatus(camp.status)}
                    />
                  ) : (
                    <span style={{ color: "#9C8E7A" }}>—</span>
                  )}
                </td>
                <td className="px-5 py-3 hidden md:table-cell" style={{ color: "#4B3D2E" }}>
                  {camp.nextEligibleDate ? formatDate(camp.nextEligibleDate) : "—"}
                </td>
                <td className="px-5 py-3">
                  {chip ? (
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{ background: chip.bg, color: chip.color }}
                    >
                      {chip.label}
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
