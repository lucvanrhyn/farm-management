// app/[farmSlug]/admin/animals/[id]/_components/ReproductionTab.tsx
// Reproductive history list — heat / AI / scan / calving with colour-coded
// badges per outcome.

import Link from "next/link";
import type { Observation } from "@prisma/client";
import { parseDetails } from "./tabs";

const REPRO_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  heat_detection:    { bg: "rgba(180,110,20,0.12)",  text: "#8B6914", label: "In Heat"   },
  insemination:      { bg: "rgba(59,130,246,0.12)",  text: "#1D4ED8", label: "AI"        },
  pregnancy_scan:    { bg: "rgba(74,124,89,0.12)",   text: "#2D6A4F", label: "Scan"      },
  calving:           { bg: "rgba(13,148,136,0.12)",  text: "#0F766E", label: "Calving"   },
};

function reproBadgeLabel(type: string, details: Record<string, unknown>): string {
  if (type === "pregnancy_scan") {
    const r = details.result as string | undefined;
    if (r === "pregnant") return "Scan — Pregnant";
    if (r === "empty")    return "Scan — Empty";
    if (r === "uncertain") return "Scan — Uncertain";
    return "Scan";
  }
  if (type === "calving") {
    const s = details.calf_status as string | undefined;
    return s === "stillborn" ? "Calving — Stillborn" : "Calving — Live";
  }
  return REPRO_BADGE[type]?.label ?? type.replace(/_/g, " ");
}

function reproBadgeStyle(type: string, details: Record<string, unknown>): { bg: string; text: string } {
  if (type === "pregnancy_scan") {
    const r = details.result as string | undefined;
    if (r === "pregnant") return { bg: "rgba(74,124,89,0.12)",   text: "#2D6A4F" };
    if (r === "empty")    return { bg: "rgba(192,87,76,0.12)",   text: "#8B3A3A" };
    return { bg: "rgba(180,110,20,0.12)", text: "#8B6914" };
  }
  if (type === "calving") {
    const s = details.calf_status as string | undefined;
    return s === "stillborn"
      ? { bg: "rgba(192,87,76,0.12)", text: "#8B3A3A" }
      : { bg: "rgba(13,148,136,0.12)", text: "#0F766E" };
  }
  return REPRO_BADGE[type] ?? { bg: "rgba(156,142,122,0.12)", text: "#9C8E7A" };
}

interface ReproductionTabProps {
  reproObs: Observation[];
  farmSlug: string;
}

export function ReproductionTab({ reproObs, farmSlug }: ReproductionTabProps) {
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
          Reproductive History ({reproObs.length})
        </h2>
        <Link
          href={`/${farmSlug}/admin/reproduction`}
          className="text-xs font-medium transition-opacity hover:opacity-70"
          style={{ color: "#8B6914" }}
        >
          View Repro Dashboard →
        </Link>
      </div>
      {reproObs.length === 0 ? (
        <p className="text-xs" style={{ color: "#9C8E7A" }}>No reproductive events recorded.</p>
      ) : (
        <ol className="space-y-3">
          {reproObs.map((obs) => {
            const d = parseDetails(obs.details);
            const date = new Date(obs.observedAt).toLocaleDateString("en-ZA");
            const style = reproBadgeStyle(obs.type, d);
            const label = reproBadgeLabel(obs.type, d);
            return (
              <li
                key={obs.id}
                className="flex items-start gap-3 py-2.5"
                style={{ borderBottom: "1px solid #E0D5C8" }}
              >
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 mt-0.5"
                  style={{ background: style.bg, color: style.text }}
                >
                  {label}
                </span>
                <div className="flex-1 min-w-0">
                  {obs.type === "insemination" && (
                    <p className="text-xs" style={{ color: "#1C1815" }}>
                      {d.bull_id ? `Bull: ${d.bull_id}` : d.semen_batch ? `Batch: ${d.semen_batch}` : ""}
                    </p>
                  )}
                  {obs.type === "pregnancy_scan" && d.expected_calving && (
                    <p className="text-xs" style={{ color: "#1C1815" }}>
                      Expected: {String(d.expected_calving).split("T")[0]}
                    </p>
                  )}
                  {obs.type === "calving" && d.calf_tag && (
                    <p className="text-xs" style={{ color: "#1C1815" }}>
                      Calf tag: <span className="font-mono">{String(d.calf_tag)}</span>
                    </p>
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
