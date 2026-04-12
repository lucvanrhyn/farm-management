"use client";

import { useState, useMemo } from "react";
import AlertCard from "@/components/admin/AlertCard";
import type { DashboardAlert, AlertSource } from "@/lib/server/dashboard-alerts";

type SeverityFilter = "all" | "red" | "amber";
type SpeciesFilter = "all" | AlertSource;

const SEVERITY_OPTIONS: { value: SeverityFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "red", label: "Critical" },
  { value: "amber", label: "Caution" },
];

const SPECIES_OPTIONS: { value: SpeciesFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "cattle", label: "Cattle" },
  { value: "sheep", label: "Sheep" },
  { value: "game", label: "Game" },
  { value: "farm", label: "Farm" },
];

interface Props {
  alerts: DashboardAlert[];
}

export default function AlertsFilterClient({ alerts }: Props) {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [speciesFilter, setSpeciesFilter] = useState<SpeciesFilter>("all");

  const redCount = useMemo(() => alerts.filter((a) => a.severity === "red").length, [alerts]);
  const amberCount = useMemo(() => alerts.filter((a) => a.severity === "amber").length, [alerts]);

  const filtered = useMemo(() => {
    const result = alerts.filter((a) => {
      if (severityFilter !== "all" && a.severity !== severityFilter) return false;
      if (speciesFilter !== "all" && a.species !== speciesFilter) return false;
      return true;
    });
    // Red first, then amber
    return result.sort((a, b) => {
      if (a.severity === "red" && b.severity !== "red") return -1;
      if (a.severity !== "red" && b.severity === "red") return 1;
      return 0;
    });
  }, [alerts, severityFilter, speciesFilter]);

  // All-clear state
  if (alerts.length === 0) {
    return (
      <div
        className="rounded-xl px-5 py-4 flex items-center gap-3"
        style={{ background: "rgba(74,124,89,0.08)", border: "1px solid rgba(74,124,89,0.2)" }}
      >
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#4A7C59" }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: "#4A7C59" }}>All clear</p>
          <p className="text-xs mt-0.5" style={{ color: "#6B8F72" }}>No alerts across any species.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* KPI bar */}
      <div className="flex flex-wrap gap-3">
        <div
          className="flex items-center gap-2 rounded-lg px-3.5 py-2"
          style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
        >
          <span className="text-lg font-bold font-mono" style={{ color: "#1C1815" }}>
            {alerts.length}
          </span>
          <span className="text-xs" style={{ color: "#9C8E7A" }}>Total Alerts</span>
        </div>
        <div
          className="flex items-center gap-2 rounded-lg px-3.5 py-2"
          style={{ background: "rgba(192,87,76,0.06)", border: "1px solid rgba(192,87,76,0.2)" }}
        >
          <span className="text-lg font-bold font-mono" style={{ color: "#C0574C" }}>
            {redCount}
          </span>
          <span className="text-xs" style={{ color: "#C0574C" }}>Critical</span>
        </div>
        <div
          className="flex items-center gap-2 rounded-lg px-3.5 py-2"
          style={{ background: "rgba(139,105,20,0.06)", border: "1px solid rgba(139,105,20,0.2)" }}
        >
          <span className="text-lg font-bold font-mono" style={{ color: "#8B6914" }}>
            {amberCount}
          </span>
          <span className="text-xs" style={{ color: "#8B6914" }}>Caution</span>
        </div>
      </div>

      {/* Filter controls */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
            Severity
          </span>
          <div className="flex gap-1">
            {SEVERITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSeverityFilter(opt.value)}
                className="text-xs font-medium px-2.5 py-1 rounded-full transition-colors"
                style={{
                  background: severityFilter === opt.value ? "rgba(139,105,20,0.12)" : "transparent",
                  color: severityFilter === opt.value ? "#8B6914" : "#9C8E7A",
                  border: `1px solid ${severityFilter === opt.value ? "rgba(139,105,20,0.25)" : "#E0D5C8"}`,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
            Source
          </span>
          <div className="flex gap-1">
            {SPECIES_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSpeciesFilter(opt.value)}
                className="text-xs font-medium px-2.5 py-1 rounded-full transition-colors"
                style={{
                  background: speciesFilter === opt.value ? "rgba(139,105,20,0.12)" : "transparent",
                  color: speciesFilter === opt.value ? "#8B6914" : "#9C8E7A",
                  border: `1px solid ${speciesFilter === opt.value ? "rgba(139,105,20,0.25)" : "#E0D5C8"}`,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Alert list */}
      {filtered.length === 0 ? (
        <div
          className="rounded-xl px-5 py-4 text-center"
          style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
        >
          <p className="text-sm" style={{ color: "#9C8E7A" }}>
            No alerts match the selected filters.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((alert) => (
            <AlertCard key={alert.id} alert={alert} />
          ))}
        </div>
      )}
    </div>
  );
}
