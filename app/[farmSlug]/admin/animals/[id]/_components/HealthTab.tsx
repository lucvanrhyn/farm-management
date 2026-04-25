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
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#9C8E7A" }}>
        Health History ({healthObs.length})
      </h2>
      {healthObs.length === 0 ? (
        <p className="text-xs" style={{ color: "#9C8E7A" }}>No health records.</p>
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
                style={{ borderBottom: "1px solid #E0D5C8" }}
              >
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 mt-0.5"
                  style={
                    isIssue
                      ? { background: "rgba(192,87,76,0.12)", color: "#8B3A3A" }
                      : { background: "rgba(59,130,246,0.12)", color: "#1D4ED8" }
                  }
                >
                  {isIssue ? "Issue" : "Treatment"}
                </span>
                <div className="flex-1 min-w-0">
                  {isIssue && Array.isArray(d.symptoms) && (
                    <p className="text-xs font-medium" style={{ color: "#1C1815" }}>
                      {(d.symptoms as string[]).join(", ")}
                    </p>
                  )}
                  {!isIssue && (
                    <p className="text-xs font-medium" style={{ color: "#1C1815" }}>
                      {[d.drug ?? d.product_name, d.dose ?? d.dosage].filter(Boolean).join(" — ")}
                    </p>
                  )}
                  {d.severity && (
                    <p className="text-xs" style={{ color: "#9C8E7A" }}>Severity: {String(d.severity)}</p>
                  )}

                  <p className="text-[11px] mt-0.5" style={{ color: "#9C8E7A" }}>
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
