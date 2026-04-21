"use client";

/**
 * MethodologyForm — client form for editing the Farm Methodology Object.
 *
 * All fields are freeform strings in v1 (see
 * research-phase-l-farm-einstein.md §Topic F). Save posts to the matching
 * API route; tier enforcement happens server-side. The `disabled` prop is
 * used to render Basic tier in read-only mode so farmers can preview what
 * Advanced unlocks.
 */

import { useCallback, useState } from "react";
import type { FarmMethodology } from "@/lib/einstein/settings-schema";

export interface MethodologyFormProps {
  readonly farmSlug: string;
  readonly initial: FarmMethodology;
  readonly disabled?: boolean;
}

interface SaveState {
  readonly status: "idle" | "saving" | "saved" | "error";
  readonly message?: string;
}

const FIELD_COPY: Array<{
  readonly key: keyof FarmMethodology;
  readonly label: string;
  readonly placeholder: string;
  readonly helper: string;
  readonly rows: number;
}> = [
  {
    key: "tier",
    label: "Farm tier / style",
    placeholder: "commercial mixed cow-calf",
    helper: "Short descriptor — how you'd describe this farm in one line.",
    rows: 1,
  },
  {
    key: "speciesMix",
    label: "Species mix",
    placeholder: "60% Brangus cows, 20% Merino ewes, 20% mixed game",
    helper: "Rough composition by headcount, LSU, or farmer judgment.",
    rows: 2,
  },
  {
    key: "breedingCalendar",
    label: "Breeding calendar",
    placeholder: "Oct–Dec joining, July–Sept calving, weaning at 6 months",
    helper: "When joining happens, when you expect young, weaning timing.",
    rows: 3,
  },
  {
    key: "rotationPolicy",
    label: "Rotation policy",
    placeholder: "14-camp rotation, 3–5 days grazing, 60-day rest target",
    helper: "Any rules of thumb for moving mobs.",
    rows: 3,
  },
  {
    key: "lsuThresholds",
    label: "LSU / stocking thresholds",
    placeholder: "Warn at 0.12 LSU/ha dry season, critical at 0.18",
    helper: "Where this farm gets uncomfortable versus dangerous.",
    rows: 2,
  },
  {
    key: "farmerNotes",
    label: "Farmer notes",
    placeholder: "What makes this farm unique — terrain, soil, history, gotchas.",
    helper: "Free text — Einstein reads this as background every answer.",
    rows: 4,
  },
];

export default function MethodologyForm({
  farmSlug,
  initial,
  disabled = false,
}: MethodologyFormProps) {
  const [fields, setFields] = useState<FarmMethodology>(() => ({
    tier: initial.tier ?? "",
    speciesMix: initial.speciesMix ?? "",
    breedingCalendar: initial.breedingCalendar ?? "",
    rotationPolicy: initial.rotationPolicy ?? "",
    lsuThresholds: initial.lsuThresholds ?? "",
    farmerNotes: initial.farmerNotes ?? "",
  }));
  const [save, setSave] = useState<SaveState>({ status: "idle" });

  const onChange = useCallback(
    (key: keyof FarmMethodology) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const value = e.target.value;
        setFields((prev) => ({ ...prev, [key]: value }));
      },
    [],
  );

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (disabled) return;
      setSave({ status: "saving" });
      try {
        const response = await fetch(
          `/api/${farmSlug}/farm-settings/methodology`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ methodology: fields }),
          },
        );
        if (!response.ok) {
          let message = "Save failed";
          try {
            const body = (await response.json()) as {
              error?: string;
              message?: string;
            };
            message = body.message ?? body.error ?? message;
          } catch {
            /* non-JSON — keep default */
          }
          setSave({ status: "error", message });
          return;
        }
        setSave({ status: "saved", message: "Saved" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Network error";
        setSave({ status: "error", message });
      }
    },
    [disabled, farmSlug, fields],
  );

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 rounded-xl p-5"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      data-testid="methodology-form"
    >
      {FIELD_COPY.map((f) => (
        <div key={f.key} className="flex flex-col gap-1">
          <label
            htmlFor={`methodology-${f.key}`}
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "#6B5E50" }}
          >
            {f.label}
          </label>
          {f.rows <= 1 ? (
            <input
              id={`methodology-${f.key}`}
              type="text"
              value={fields[f.key] ?? ""}
              onChange={onChange(f.key)}
              placeholder={f.placeholder}
              disabled={disabled}
              className="rounded-md border px-3 py-2 text-sm disabled:bg-stone-100 disabled:cursor-not-allowed"
              style={{
                borderColor: "#E0D5C8",
                color: "#1C1815",
              }}
            />
          ) : (
            <textarea
              id={`methodology-${f.key}`}
              value={fields[f.key] ?? ""}
              onChange={onChange(f.key)}
              placeholder={f.placeholder}
              rows={f.rows}
              disabled={disabled}
              className="rounded-md border px-3 py-2 text-sm resize-y disabled:bg-stone-100 disabled:cursor-not-allowed"
              style={{
                borderColor: "#E0D5C8",
                color: "#1C1815",
              }}
            />
          )}
          <p className="text-[11px]" style={{ color: "#9C8E7A" }}>
            {f.helper}
          </p>
        </div>
      ))}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={disabled || save.status === "saving"}
          className="rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: "#8B6914",
            color: "#F5EBD4",
          }}
          data-testid="methodology-save"
        >
          {save.status === "saving" ? "Saving…" : "Save methodology"}
        </button>
        {save.status === "saved" ? (
          <span className="text-sm" style={{ color: "#3A6B49" }}>
            ✓ {save.message}
          </span>
        ) : null}
        {save.status === "error" ? (
          <span className="text-sm" style={{ color: "#B23B3B" }}>
            {save.message ?? "Save failed"}
          </span>
        ) : null}
      </div>
    </form>
  );
}
