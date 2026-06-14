import Link from "next/link";
import {
  Baby,
  Calendar,
  CalendarClock,
  TrendingDown,
  AlertTriangle,
  Droplets,
  Scissors,
  FileWarning,
  AlertOctagon,
  ClipboardX,
  FlaskConical,
  Tent,
  ClipboardCheck,
  Clock,
  type LucideIcon,
} from "lucide-react";
import type { DashboardAlert, AlertSource } from "@/lib/server/dashboard-alerts";

const ICON_MAP: Record<string, LucideIcon> = {
  Baby,
  Calendar,
  CalendarClock,
  TrendingDown,
  AlertTriangle,
  Droplets,
  Scissors,
  FileWarning,
  AlertOctagon,
  ClipboardX,
  FlaskConical,
  Tent,
  ClipboardCheck,
  Clock,
};

const SPECIES_BADGE: Record<AlertSource, { label: string; bg: string; text: string }> = {
  cattle: { label: "Cattle", bg: "rgba(139,105,20,0.10)", text: "var(--ft-fair)" },
  sheep:  { label: "Sheep",  bg: "rgba(74,124,89,0.10)",  text: "var(--ft-good)" },
  game:   { label: "Game",   bg: "rgba(107,94,80,0.12)",  text: "var(--ft-muted)" },
  farm:   { label: "Farm",   bg: "rgba(28,24,21,0.07)",   text: "var(--ft-subtle)" },
};

export default function AlertCard({ alert }: { alert: DashboardAlert }) {
  const isRed = alert.severity === "red";
  const dotColor = isRed ? "var(--ft-poor)" : "var(--ft-fair)";
  const borderColor = isRed ? "rgba(192,87,76,0.25)" : "rgba(139,105,20,0.25)";
  const bgColor = isRed ? "rgba(192,87,76,0.06)" : "rgba(139,105,20,0.06)";
  const badgeBg = isRed ? "rgba(192,87,76,0.12)" : "rgba(139,105,20,0.12)";
  const textColor = isRed ? "var(--ft-poor)" : "var(--ft-fair)";

  const Icon = ICON_MAP[alert.icon];
  const badge = SPECIES_BADGE[alert.species];

  return (
    <Link
      href={alert.href}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-opacity hover:opacity-80"
      style={{ background: bgColor, border: `1px solid ${borderColor}` }}
    >
      {/* Icon or dot fallback */}
      {Icon ? (
        <Icon className="w-4 h-4 shrink-0" style={{ color: dotColor }} />
      ) : (
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dotColor }} />
      )}

      {/* Species badge */}
      <span
        className="text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0"
        style={{ background: badge.bg, color: badge.text }}
      >
        {badge.label}
      </span>

      {/* Message */}
      <span className="flex-1 text-sm min-w-0 truncate" style={{ color: "var(--ft-text)" }}>
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
      <span className="text-xs shrink-0" style={{ color: textColor }}>
        &rarr;
      </span>
    </Link>
  );
}
