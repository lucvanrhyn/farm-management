// app/[farmSlug]/admin/animals/[id]/_components/HealthTab.tsx
// Health-issue / treatment timeline for a single animal.

import type { Observation } from "@prisma/client";
import { parseDetails } from "./tabs";

interface HealthTabProps {
  healthObs: Observation[];
}

export function HealthTab({ healthObs }: HealthTabProps) {
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ background: "var(--ft-surface)", border: "1px solid var(--ft-border)" }}
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "var(--ft-subtle)" }}>
        Health History ({healthObs.length})
      </h2>
      {healthObs.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--ft-subtle)" }}>No health records.</p>
      ) : (
        <ol className="space-y-3">
          {healthObs.map((obs) => {
            const d = parseDetails(obs.details);
            const date = new Date(obs.observedAt).toLocaleDateString("en-ZA");
            const isIssue = obs.type === "health_issue";
            return (
              <li
                key={obs.id}
                className="flex items-start gap-3 py-2.5"
                style={{ borderBottom: "1px solid var(--ft-border)" }}
              >
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 mt-0.5"
                  style={
                    isIssue
                      ? { background: "rgba(192,87,76,0.12)", color: "var(--ft-crit)" }
                      : { background: "rgba(59,130,246,0.12)", color: "var(--ft-info)" }
                  }
                >
                  {isIssue ? "Issue" : "Treatment"}
                </span>
                <div className="flex-1 min-w-0">
                  {isIssue && Array.isArray(d.symptoms) && (
                    <p className="text-xs font-medium" style={{ color: "var(--ft-text)" }}>
                      {(d.symptoms as string[]).join(", ")}
                    </p>
                  )}
                  {!isIssue && (
                    <p className="text-xs font-medium" style={{ color: "var(--ft-text)" }}>
                      {[d.drug ?? d.product_name, d.dose ?? d.dosage].filter(Boolean).join(" — ")}
                    </p>
                  )}
                  {d.severity && (
                    <p className="text-xs" style={{ color: "var(--ft-subtle)" }}>Severity: {String(d.severity)}</p>
                  )}

                  <p className="text-[11px] mt-0.5" style={{ color: "var(--ft-subtle)" }}>
                    {date} · Camp: {obs.campId}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
