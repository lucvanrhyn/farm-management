// components/admin/NeedsAttentionPanel.tsx
import Link from "next/link";
import type { DashboardAlerts, DashboardAlert } from "@/lib/server/dashboard-alerts";

interface Props {
  alerts: DashboardAlerts;
  farmSlug: string;
}

function AlertRow({ alert }: { alert: DashboardAlert }) {
  const isRed = alert.severity === "red";
  const dotColor = isRed ? "#C0574C" : "#8B6914";
  const borderColor = isRed ? "rgba(192,87,76,0.25)" : "rgba(139,105,20,0.25)";
  const bgColor = isRed ? "rgba(192,87,76,0.06)" : "rgba(139,105,20,0.06)";
  const badgeBg = isRed ? "rgba(192,87,76,0.12)" : "rgba(139,105,20,0.12)";
  const textColor = isRed ? "#C0574C" : "#8B6914";

  return (
    <Link
      href={alert.href}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-opacity hover:opacity-80"
      style={{
        background: bgColor,
        border: `1px solid ${borderColor}`,
      }}
    >
      {/* Colored dot indicator */}
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ background: dotColor }}
      />

      {/* Message */}
      <span className="flex-1 text-sm" style={{ color: "#1C1815" }}>
        {alert.message}
      </span>

      {/* Count badge */}
      <span
        className="text-xs font-semibold font-mono px-2 py-0.5 rounded-full shrink-0"
        style={{ background: badgeBg, color: textColor }}
      >
        {alert.count}
      </span>

      {/* Arrow */}
      <span className="text-xs shrink-0" style={{ color: textColor }}>→</span>
    </Link>
  );
}

export default function NeedsAttentionPanel({ alerts, farmSlug: _farmSlug }: Props) {
  if (alerts.totalCount === 0) {
    return (
      <div
        className="rounded-xl px-5 py-4 flex items-center gap-3 mb-6"
        style={{ background: "rgba(74,124,89,0.08)", border: "1px solid rgba(74,124,89,0.2)" }}
      >
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#4A7C59" }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: "#4A7C59" }}>All clear</p>
          <p className="text-xs mt-0.5" style={{ color: "#6B8F72" }}>No immediate actions required.</p>
        </div>
      </div>
    );
  }

  const borderStyle = alerts.red.length > 0
    ? "rgba(192,87,76,0.3)"
    : "rgba(139,105,20,0.3)";

  return (
    <div
      className="rounded-xl p-4 mb-6"
      style={{
        background: "#FFFFFF",
        border: `1px solid ${borderStyle}`,
        borderLeft: `4px solid ${alerts.red.length > 0 ? "#C0574C" : "#8B6914"}`,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: alerts.red.length > 0 ? "#C0574C" : "#8B6914" }}
        >
          Needs Attention
        </span>
        <span
          className="text-xs font-semibold font-mono px-2 py-0.5 rounded-full"
          style={{
            background: alerts.red.length > 0 ? "rgba(192,87,76,0.12)" : "rgba(139,105,20,0.12)",
            color: alerts.red.length > 0 ? "#C0574C" : "#8B6914",
          }}
        >
          {alerts.totalCount} {alerts.totalCount === 1 ? "item" : "items"}
        </span>
      </div>

      {/* Red alerts section */}
      {alerts.red.length > 0 && (
        <div className="flex flex-col gap-2 mb-3">
          {alerts.red.map((alert) => (
            <AlertRow key={alert.id} alert={alert} />
          ))}
        </div>
      )}

      {/* Amber alerts section */}
      {alerts.amber.length > 0 && (
        <>
          {alerts.red.length > 0 && (
            <div
              className="my-2"
              style={{ borderTop: "1px solid #F0EAE0" }}
            />
          )}
          <div className="flex flex-col gap-2">
            {alerts.amber.map((alert) => (
              <AlertRow key={alert.id} alert={alert} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
