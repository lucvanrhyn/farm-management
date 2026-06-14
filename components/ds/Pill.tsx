import * as React from "react";
import { cn } from "@/lib/utils";

export type Tone = "good" | "fair" | "poor" | "crit" | "critical" | "info" | "muted";
export type Status = "good" | "fair" | "poor" | "critical";

const TONE_CLASS: Record<Tone, string> = {
  good: "ft-pill-good",
  fair: "ft-pill-fair",
  poor: "ft-pill-poor",
  crit: "ft-pill-crit",
  critical: "ft-pill-crit",
  info: "ft-pill-info",
  muted: "ft-pill-muted",
};

export function Pill({
  tone = "muted",
  icon,
  children,
  className,
  ...rest
}: { tone?: Tone; icon?: React.ReactNode } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("ft-pill", TONE_CLASS[tone], className)} {...rest}>
      {icon}
      {children}
    </span>
  );
}

const DOT_COLOR: Record<Status, string> = {
  good: "var(--ft-good)",
  fair: "var(--ft-fair)",
  poor: "var(--ft-poor)",
  critical: "var(--ft-crit)",
};
const DOT_HALO: Record<Status, string> = {
  good: "rgba(74,124,89,.15)",
  fair: "rgba(180,139,42,.15)",
  poor: "rgba(196,90,46,.15)",
  critical: "rgba(139,58,58,.15)",
};

export function StatusDot({ status, size = 8 }: { status: Status; size?: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 999,
        background: DOT_COLOR[status],
        boxShadow: `0 0 0 3px ${DOT_HALO[status]}`,
      }}
    />
  );
}

const STATUS_LABEL: Record<Status, string> = {
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  critical: "Critical",
};

export function StatusPill({ status, label }: { status: Status; label?: string }) {
  const tone: Tone = status === "critical" ? "critical" : status;
  return (
    <Pill tone={tone} icon={<StatusDot status={status} size={6} />}>
      {label ?? STATUS_LABEL[status]}
    </Pill>
  );
}
