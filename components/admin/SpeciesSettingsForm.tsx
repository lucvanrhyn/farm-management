"use client";

import React, { useState } from "react";
import { Beef, Rabbit, Target } from "lucide-react";

export type SpeciesRow = {
  id: string;
  label: string;
  icon: string;
  enabled: boolean;
  required: boolean;
};

const ICON_MAP: Record<string, React.ElementType> = {
  Beef,
  Rabbit,
  Target,
};

type RowStatus = "idle" | "saving" | "saved" | "error";

function SpeciesToggle({
  enabled,
  disabled,
  onToggle,
}: {
  enabled: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={onToggle}
      className="relative inline-flex items-center h-6 w-11 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
      style={{
        background: enabled ? "#3A6B49" : "#9C8E7A",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span
        className="inline-block w-4 h-4 rounded-full bg-white shadow transition-transform"
        style={{
          transform: enabled ? "translateX(26px)" : "translateX(2px)",
        }}
      />
    </button>
  );
}

function SpeciesCard({
  row,
  onToggle,
  status,
}: {
  row: SpeciesRow;
  onToggle: (id: string, newEnabled: boolean) => void;
  status: RowStatus;
}) {
  const Icon = ICON_MAP[row.icon] ?? Beef;

  return (
    <div
      className="flex items-center justify-between gap-4 rounded-xl p-4"
      style={{
        background: "#FFFFFF",
        border: "1px solid rgba(28,24,21,0.08)",
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "rgba(58,107,73,0.1)" }}
        >
          <Icon className="w-4 h-4" style={{ color: "#3A6B49" }} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold" style={{ color: "#1C1815" }}>
            {row.label}
          </p>
          {row.required ? (
            <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
              Core species — always enabled
            </p>
          ) : (
            <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
              {row.enabled ? "Enabled" : "Disabled"}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {status === "saved" && (
          <span className="text-xs font-medium" style={{ color: "#3A6B49" }}>
            Saved
          </span>
        )}
        {status === "error" && (
          <span className="text-xs font-medium" style={{ color: "#B91C1C" }}>
            Error
          </span>
        )}
        {status === "saving" && (
          <span className="text-xs" style={{ color: "#9C8E7A" }}>
            Saving…
          </span>
        )}

        {row.required ? (
          <SpeciesToggle enabled={true} disabled={true} onToggle={() => {}} />
        ) : (
          <SpeciesToggle
            enabled={row.enabled}
            disabled={status === "saving"}
            onToggle={() => onToggle(row.id, !row.enabled)}
          />
        )}
      </div>
    </div>
  );
}

export default function SpeciesSettingsForm({
  farmSlug,
  species,
}: {
  farmSlug: string;
  species: SpeciesRow[];
}) {
  const [rows, setRows] = useState<SpeciesRow[]>(species);
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});

  async function handleToggle(id: string, newEnabled: boolean) {
    // Optimistic update
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: newEnabled } : r))
    );
    setRowStatus((prev) => ({ ...prev, [id]: "saving" }));

    try {
      const res = await fetch(`/api/farm/species-settings?farmSlug=${encodeURIComponent(farmSlug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ species: id, enabled: newEnabled }),
      });

      if (!res.ok) {
        throw new Error("Request failed");
      }

      setRowStatus((prev) => ({ ...prev, [id]: "saved" }));
      setTimeout(() => {
        setRowStatus((prev) => ({ ...prev, [id]: "idle" }));
      }, 2000);
    } catch {
      // Revert optimistic update
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, enabled: !newEnabled } : r))
      );
      setRowStatus((prev) => ({ ...prev, [id]: "error" }));
      setTimeout(() => {
        setRowStatus((prev) => ({ ...prev, [id]: "idle" }));
      }, 3000);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <SpeciesCard
          key={row.id}
          row={row}
          onToggle={handleToggle}
          status={rowStatus[row.id] ?? "idle"}
        />
      ))}
    </div>
  );
}
