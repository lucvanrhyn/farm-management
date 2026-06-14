// components/admin/observations-log/fields.tsx
// Per-observation-type input fields rendered inside EditModal. Each
// component is a thin wrapper around a select/input shaped by the vocab
// arrays in `./constants`. ReadOnlyDetails covers types not in
// EDITABLE_TYPES.

"use client";

import React from "react";
import {
  DEATH_CAUSES,
  FENCE_STATUS,
  GRAZING_QUALITY,
  REPRODUCTION_EVENTS,
  SEVERITIES,
  SYMPTOMS,
  TREATMENT_TYPES,
  WATER_STATUS,
  fieldInput,
} from "./constants";

export interface FieldProps {
  details: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

export function WeighingFields({ details, onChange }: FieldProps) {
  return (
    <div className="flex flex-col gap-3">
      <label className="text-xs font-semibold" style={{ color: "var(--ft-muted)" }}>
        Weight (kg) *
        <input
          type="number"
          step="0.1"
          // #487 — EditModal weight input. Client-side UX feedback only; the
          // `updateObservation` door's species-aware weight gate is the source
          // of truth. `min={1}` blocks negatives / zero; `max={1500}` is the
          // absolute ceiling (this form has no species context).
          min={1}
          max={1500}
          value={(details.weight_kg as number) ?? ""}
          onChange={(e) => onChange("weight_kg", e.target.value ? parseFloat(e.target.value) : "")}
          style={fieldInput}
          className="mt-1 block"
        />
      </label>
    </div>
  );
}

export function TreatmentFields({ details, onChange }: FieldProps) {
  return (
    <div className="flex flex-col gap-3">
      <label className="text-xs font-semibold" style={{ color: "var(--ft-muted)" }}>
        Treatment Type *
        <select
          value={(details.treatmentType as string) ?? ""}
          onChange={(e) => onChange("treatmentType", e.target.value)}
          style={fieldInput}
          className="mt-1 block"
        >
          <option value="">Select...</option>
          {TREATMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <label className="text-xs font-semibold" style={{ color: "var(--ft-muted)" }}>
        Product *
        <input
          type="text"
          value={(details.product as string) ?? ""}
          onChange={(e) => onChange("product", e.target.value)}
          style={fieldInput}
          className="mt-1 block"
        />
      </label>
      <label className="text-xs font-semibold" style={{ color: "var(--ft-muted)" }}>
        Dose *
        <input
          type="text"
          value={(details.dose as string) ?? ""}
          onChange={(e) => onChange("dose", e.target.value)}
          style={fieldInput}
          className="mt-1 block"
        />
      </label>
      <label className="text-xs font-semibold" style={{ color: "var(--ft-muted)" }}>
        Withdrawal Days
        <input
          type="number"
          value={(details.withdrawalDays as number) ?? ""}
          onChange={(e) => onChange("withdrawalDays", e.target.value ? parseInt(e.target.value) : "")}
          style={fieldInput}
          className="mt-1 block"
        />
      </label>
    </div>
  );
}

export function HealthIssueFields({ details, onChange }: FieldProps) {
  return (
    <div className="flex flex-col gap-3">
      <label className="text-xs font-semibold" style={{ color: "var(--ft-muted)" }}>
        Symptom *
        <select
          value={(details.symptom as string) ?? (Array.isArray(details.symptoms) ? (details.symptoms as string[])[0] ?? "" : "")}
          onChange={(e) => onChange("symptom", e.target.value)}
          style={fieldInput}
          className="mt-1 block"
        >
          <option value="">Select...</option>
          {SYMPTOMS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label className="text-xs font-semibold" style={{ color: "var(--ft-muted)" }}>
        Severity *
        <select
          value={(details.severity as string) ?? ""}
          onChange={(e) => onChange("severity", e.target.value)}
          style={fieldInput}
          className="mt-1 block"
        >
          <option value="">Select...</option>
          {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
    </div>
  );
}

export function CampConditionFields({ details, onChange }: FieldProps) {
  return (
    <div className="flex flex-col gap-3">
      <label className="text-xs font-semibold" style={{ color: "var(--ft-muted)" }}>
        Grazing Quality *
        <select
          value={(details.grazingQuality as string) ?? (details.grazing as string) ?? (details.grazing_quality as string) ?? ""}
          onChange={(e) => onChange("grazingQuality", e.target.value)}
          style={fieldInput}
          className="mt-1 block"
        >
          <option value="">Select...</option>
          {GRAZING_QUALITY.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </label>
      <label className="text-xs font-semibold" style={{ color: "var(--ft-muted)" }}>
        Water Status *
        <select
          value={(details.waterStatus as string) ?? (details.water as string) ?? (details.water_status as string) ?? ""}
          onChange={(e) => onChange("waterStatus", e.target.value)}
          style={fieldInput}
          className="mt-1 block"
        >
          <option value="">Select...</option>
          {WATER_STATUS.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
      </label>
      <label className="text-xs font-semibold" style={{ color: "var(--ft-muted)" }}>
        Fence Status *
        <select
          value={(details.fenceStatus as string) ?? (details.fence as string) ?? ""}
          onChange={(e) => onChange("fenceStatus", e.target.value)}
          style={fieldInput}
          className="mt-1 block"
        >
          <option value="">Select...</option>
          {FENCE_STATUS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </label>
    </div>
  );
}

export function ReproductionFields({ details, onChange }: FieldProps) {
  return (
    <div className="flex flex-col gap-3">
      <label className="text-xs font-semibold" style={{ color: "var(--ft-muted)" }}>
        Event Type *
        <select
          value={(details.eventType as string) ?? ""}
          onChange={(e) => onChange("eventType", e.target.value)}
          style={fieldInput}
          className="mt-1 block"
        >
          <option value="">Select...</option>
          {REPRODUCTION_EVENTS.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </label>
    </div>
  );
}

export function DeathFields({ details, onChange }: FieldProps) {
  return (
    <div className="flex flex-col gap-3">
      <label className="text-xs font-semibold" style={{ color: "var(--ft-muted)" }}>
        Cause *
        <select
          value={(details.cause as string) ?? ""}
          onChange={(e) => onChange("cause", e.target.value)}
          style={fieldInput}
          className="mt-1 block"
        >
          <option value="">Select...</option>
          {DEATH_CAUSES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
    </div>
  );
}

export function ReadOnlyDetails({ details }: { details: Record<string, unknown> }) {
  // Render a friendlier key/value table first; allow power users to drill into raw JSON.
  const entries = Object.entries(details).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return (
    <div className="flex flex-col gap-2">
      {entries.length > 0 ? (
        <dl className="text-xs grid grid-cols-[auto,1fr] gap-x-4 gap-y-1">
          {entries.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="font-semibold capitalize" style={{ color: "var(--ft-muted)" }}>
                {k.replace(/_/g, " ").replace(/([A-Z])/g, " $1").trim()}
              </dt>
              <dd style={{ color: "var(--ft-text)" }}>
                {Array.isArray(v) ? v.join(", ") : String(v)}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      ) : (
        <p className="text-xs" style={{ color: "var(--ft-subtle)" }}>No additional details.</p>
      )}
      <details>
        <summary
          className="text-[11px] cursor-pointer select-none"
          style={{ color: "var(--ft-subtle)" }}
        >
          View raw details
        </summary>
        <pre
          className="mt-2 text-xs rounded-xl px-3 py-2 font-mono overflow-auto max-h-48"
          style={{ background: "var(--ft-surface)", color: "var(--ft-muted)", border: "1px solid var(--ft-border)" }}
        >
          {JSON.stringify(details, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export function TypeFields({ type, details, onChange }: FieldProps & { type: string }) {
  switch (type) {
    case "weighing":       return <WeighingFields details={details} onChange={onChange} />;
    case "treatment":      return <TreatmentFields details={details} onChange={onChange} />;
    case "health_issue":   return <HealthIssueFields details={details} onChange={onChange} />;
    case "camp_condition": return <CampConditionFields details={details} onChange={onChange} />;
    case "reproduction":   return <ReproductionFields details={details} onChange={onChange} />;
    case "death":          return <DeathFields details={details} onChange={onChange} />;
    default:               return <ReadOnlyDetails details={details} />;
  }
}
