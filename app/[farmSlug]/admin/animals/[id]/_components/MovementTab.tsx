// app/[farmSlug]/admin/animals/[id]/_components/MovementTab.tsx
// Camp-to-camp animal movement history.

import type { Observation } from "@prisma/client";
import { parseDetails } from "./tabs";

interface MovementTabProps {
  movementObs: Observation[];
}

export function MovementTab({ movementObs }: MovementTabProps) {
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#9C8E7A" }}>
        Movement History ({movementObs.length})
      </h2>
      {movementObs.length === 0 ? (
        <p className="text-xs" style={{ color: "#9C8E7A" }}>No movement records.</p>
      ) : (
        <ol className="space-y-3">
          {movementObs.map((obs) => {
            const d = parseDetails(obs.details);
            const date = new Date(obs.observedAt).toLocaleDateString("en-ZA");
            return (
              <li
                key={obs.id}
                className="flex items-center gap-3 py-2.5"
                style={{ borderBottom: "1px solid #E0D5C8" }}
              >
                <span className="text-lg shrink-0">🚚</span>
                <div className="flex-1">
                  <p className="text-xs font-medium font-mono" style={{ color: "#1C1815" }}>
                    {String(d.from_camp ?? "?")} → {String(d.to_camp ?? "?")}
                  </p>

                  <p className="text-[11px] mt-0.5" style={{ color: "#9C8E7A" }}>{date}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
