import * as React from "react";
import { cn } from "@/lib/utils";
import { Card } from "./Card";
import { StatusDot, type Status } from "./Pill";
import { Spark } from "./Spark";

/**
 * Operations KPI tile — icon top-left, optional status dot / pill top-right,
 * big tabular value, label, optional sub-detail and sparkline. Matches the
 * design's "tiles" KPI style (the landed adminKpi default).
 *
 * The big value is tagged `data-ft-ticker` so <FxRuntime> count-ups it.
 */
export function KpiCard({
  icon,
  label,
  value,
  unit,
  sub,
  status,
  badge,
  spark,
  accentValue,
  className,
  onClick,
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  value: React.ReactNode;
  /** Small unit/qualifier rendered beside the big value (e.g. "head", "in calf"). */
  unit?: React.ReactNode;
  sub?: React.ReactNode;
  status?: Status;
  badge?: React.ReactNode;
  spark?: number[];
  /** Tint the value with a status colour (e.g. green for healthy). */
  accentValue?: Status;
  className?: string;
  onClick?: () => void;
}) {
  const valueColor = accentValue
    ? { good: "var(--ft-good)", fair: "var(--ft-fair)", poor: "var(--ft-poor)", critical: "var(--ft-crit)" }[accentValue]
    : "var(--ft-text)";
  return (
    <Card
      interactive={!!onClick}
      onClick={onClick}
      className={cn("flex flex-col", className)}
      style={{ padding: "var(--ft-card-pad)", cursor: onClick ? "pointer" : undefined }}
    >
      <div className="flex items-start justify-between">
        <span style={{ color: "var(--ft-subtle)" }}>{icon}</span>
        {badge ?? (status ? <StatusDot status={status} /> : null)}
      </div>
      <div className="mt-3 flex items-end gap-2">
        <span
          className="ft-tabnums"
          data-ft-ticker
          style={{ fontSize: 34, fontWeight: 600, lineHeight: 1, color: valueColor, letterSpacing: "-0.01em" }}
        >
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 12.5, color: "var(--ft-subtle)", lineHeight: 1, paddingBottom: 2 }}>
            {unit}
          </span>
        )}
        {spark && <Spark values={spark} w={56} h={18} className="mb-1" />}
      </div>
      <div className="mt-1.5" style={{ fontSize: 12.5, color: "var(--ft-muted)" }}>
        {label}
      </div>
      {sub && (
        <div className="mt-1" style={{ fontSize: 11.5, color: "var(--ft-subtle)", lineHeight: 1.45 }}>
          {sub}
        </div>
      )}
    </Card>
  );
}
