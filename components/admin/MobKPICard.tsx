interface MobKPICardProps {
  label: string;
  value: string | number;
  sub?: string;
  status?: "good" | "warning" | "alert" | "neutral";
  icon?: string;
  detail?: string;
}

const statusColors = {
  good:    { bar: "var(--ft-good)", text: "var(--ft-good)", bg: "rgba(74,124,89,0.10)" },
  warning: { bar: "var(--ft-fair)", text: "var(--ft-fair)", bg: "rgba(139,105,20,0.10)" },
  alert:   { bar: "var(--ft-poor)", text: "var(--ft-poor)", bg: "rgba(192,87,76,0.10)" },
  neutral: { bar: "var(--ft-subtle)", text: "var(--ft-subtle)", bg: "rgba(156,142,122,0.10)" },
};

export default function MobKPICard({
  label,
  value,
  sub,
  status = "neutral",
  icon,
  detail,
}: MobKPICardProps) {
  const c = statusColors[status];

  return (
    <div
      className="rounded-2xl overflow-hidden border"
      style={{ background: "var(--ft-surface)", borderColor: "var(--ft-border)" }}
    >
      <div className="h-1" style={{ background: c.bar }} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--ft-subtle)" }}
            >
              {label}
            </p>
            <p
              className="text-3xl font-bold mt-1 font-mono leading-none"
              style={{ color: "var(--ft-text)" }}
            >
              {value}
            </p>
            {sub && (
              <p className="text-xs mt-1.5" style={{ color: "var(--ft-subtle)" }}>
                {sub}
              </p>
            )}
            {detail && (
              <p
                className="text-xs mt-2 px-2 py-0.5 rounded-md inline-block font-medium"
                style={{ background: c.bg, color: c.text }}
              >
                {detail}
              </p>
            )}
          </div>
          {icon && (
            <span className="text-2xl opacity-50 shrink-0 leading-none mt-0.5">{icon}</span>
          )}
        </div>
      </div>
    </div>
  );
}
