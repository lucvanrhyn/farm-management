"use client";

import { useState } from "react";
import type { ObservationType } from "@/lib/types";
import { getAllObservationTypes, getAllSpeciesConfigs } from "@/lib/species/registry";
import AnimalPicker from "@/components/observations/AnimalPicker";

// ─── Constants ──────────────────────────────────────────────────

// Derived from the species registry — includes shared + all species-specific types
const OBSERVATION_TYPES: { value: ObservationType; label: string }[] =
  getAllObservationTypes().map((t) => ({
    value: t.value as ObservationType,
    label: t.label,
  }));

// Animal-linked types derived from registry requiresAnimal field
const ANIMAL_LINKED_TYPES = new Set<ObservationType>(
  getAllObservationTypes()
    .filter((t) => t.requiresAnimal)
    .map((t) => t.value as ObservationType),
);

// Reproduction events derived from all species configs
const REPRODUCTION_EVENTS: string[] = Array.from(
  new Set(
    getAllSpeciesConfigs().flatMap((c) => c.reproEvents.map((e) => e.value)),
  ),
);

const TREATMENT_TYPES = ["Antibiotic", "Dip", "Deworming", "Vaccination", "Supplement", "Other"];
const WITHDRAWAL_DEFAULTS: Record<string, number> = {
  Antibiotic: 14, Dip: 7, Deworming: 7, Vaccination: 0, Supplement: 0, Other: 7,
};
const SYMPTOMS = ["Lame", "Thin", "Eye problem", "Wound", "Diarrhea", "Nasal discharge", "Bloated", "Not eating", "Other"];
const SEVERITIES = ["mild", "moderate", "severe"];
const GRAZING_QUALITY = ["Good", "Fair", "Poor", "Overgrazed"];
const WATER_STATUS = ["Full", "Low", "Empty", "Broken"];
const FENCE_STATUS = ["Intact", "Damaged"];
const DEATH_CAUSES = ["Unknown", "Redwater", "Heartwater", "Snake", "Old_age", "Birth_complications", "Other"];

// ─── Styles ─────────────────────────────────────────────────────

const fieldInput: React.CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid #E0D5C8",
  color: "#1C1815",
  borderRadius: "0.75rem",
  padding: "0.5rem 0.75rem",
  fontSize: "0.875rem",
  outline: "none",
  width: "100%",
};

// ─── Props ──────────────────────────────────────────────────────

interface CreateObservationModalProps {
  camps: { id: string; name: string }[];
  /**
   * Pre-fetched first page of active animals (≤ PAGE_SIZE on the page). Used
   * for fast offline rendering of the most-common picks. The modal also
   * exposes a server-side search (`AnimalPicker`) that reaches animals
   * outside this slice via `/api/animals?search=`.
   */
  animals: { id: string; tag: string; campId: string }[];
  /**
   * Active farm-mode species. Threaded through to the AnimalPicker so the
   * server-side search returns rows of the right species only.
   */
  species?: string | null;
  onSuccess: () => void;
  onCancel: () => void;
}

// ─── Component ──────────────────────────────────────────────────

export default function CreateObservationModal({
  camps,
  animals,
  species,
  onSuccess,
  onCancel,
}: CreateObservationModalProps) {
  const [step, setStep] = useState<"type" | "form">("type");
  const [selectedType, setSelectedType] = useState<ObservationType | null>(null);
  const [campId, setCampId] = useState("");
  const [animalId, setAnimalId] = useState("");
  const [details, setDetails] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // The SSR-prefetched `animals` array is a hot-cache of the first PAGE_SIZE
  // rows on the parent page. For animals outside that slice the AnimalPicker
  // does a debounced server-side search via /api/animals?search=. We keep the
  // prefetched list in the modal's prop surface so the server-side picker can
  // still surface a fast path (filtered by current campId) without a network
  // round-trip when the target is in the prefetch.
  const prefetchedForCamp = campId
    ? animals.filter((a) => a.campId === campId)
    : animals;

  function handleTypeSelect(type: ObservationType) {
    setSelectedType(type);
    setDetails({});
    setStep("form");
  }

  function handleFieldChange(key: string, value: unknown) {
    setDetails((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "treatmentType" && typeof value === "string") {
        next.withdrawalDays = WITHDRAWAL_DEFAULTS[value] ?? 7;
      }
      return next;
    });
  }

  async function handleSubmit() {
    if (!selectedType || !campId) return;
    setSaving(true);
    setError("");

    const cleanDetails = Object.fromEntries(
      Object.entries(details).filter(([, v]) => v !== "" && v !== undefined)
    );

    try {
      const res = await fetch("/api/observations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: selectedType,
          camp_id: campId,
          animal_id: animalId || undefined,
          details: JSON.stringify(cleanDetails),
          created_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        const e = await res.json();
        setError(e.error ?? "Failed to create observation");
        return;
      }
      onSuccess();
    } catch {
      setError("Network error — try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="rounded-2xl w-full max-w-lg mx-4 p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold" style={{ color: "#1C1815" }}>
            {step === "type" ? "New Observation" : `New ${OBSERVATION_TYPES.find((t) => t.value === selectedType)?.label ?? ""}`}
          </h3>
          <button
            onClick={onCancel}
            className="text-xl leading-none transition-opacity hover:opacity-70"
            style={{ color: "#9C8E7A" }}
          >
            ×
          </button>
        </div>

        {/* Step 1: Type selection */}
        {step === "type" && (
          <div className="grid grid-cols-2 gap-2">
            {OBSERVATION_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => handleTypeSelect(t.value)}
                className="px-4 py-3 rounded-xl text-sm font-medium text-left transition-colors hover:opacity-80"
                style={{
                  border: "1px solid #E0D5C8",
                  background: "#F5F2EE",
                  color: "#1C1815",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Step 2: Form fields */}
        {step === "form" && selectedType && (
          <div className="flex flex-col gap-4">
            {/* Common fields: camp + animal */}
            <label className="text-xs font-semibold" style={{ color: "#6B5C4E" }}>
              Camp *
              <select
                value={campId}
                onChange={(e) => { setCampId(e.target.value); setAnimalId(""); }}
                style={fieldInput}
                className="mt-1 block"
              >
                <option value="">Select camp...</option>
                {camps.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>

            {ANIMAL_LINKED_TYPES.has(selectedType) && (
              <div className="text-xs font-semibold flex flex-col gap-1" style={{ color: "#6B5C4E" }}>
                <span>Animal (optional)</span>
                {/*
                  Prefetched quick-pick: the parent page hydrates the first 50
                  active animals in the current camp. This is the common case
                  (small herd, target nearby) and avoids a network round-trip.
                */}
                {prefetchedForCamp.length > 0 && (
                  <select
                    value={animalId && prefetchedForCamp.some((a) => a.id === animalId) ? animalId : ""}
                    onChange={(e) => setAnimalId(e.target.value)}
                    style={fieldInput}
                    className="block"
                    aria-label="Quick-pick animal"
                  >
                    <option value="">Quick-pick from this camp…</option>
                    {prefetchedForCamp.map((a) => (
                      <option key={a.id} value={a.id}>{a.tag}</option>
                    ))}
                  </select>
                )}
                {/*
                  Server-side search: reaches animals outside the SSR slice.
                  Phase H replaces the legacy "raw animalId text field" fallback
                  with this debounced typeahead bound to /api/animals?search=.
                */}
                <AnimalPicker
                  species={species}
                  campId={campId || undefined}
                  value={animalId}
                  onChange={setAnimalId}
                />
                {animalId && (
                  <span className="text-[11px] font-normal" style={{ color: "#9C8E7A" }}>
                    Selected: <span className="font-mono">{animalId}</span>
                    <button
                      type="button"
                      onClick={() => setAnimalId("")}
                      className="ml-2 underline"
                      style={{ color: "#6B5C4E" }}
                    >
                      Clear
                    </button>
                  </span>
                )}
              </div>
            )}

            {/* Type-specific fields */}
            {selectedType === "weighing" && (
              <div className="flex flex-col gap-3">
                <label className="text-xs font-semibold" style={{ color: "#6B5C4E" }}>
                  Weight (kg) *
                  <input
                    type="number"
                    step="0.1"
                    value={(details.weight_kg as number) ?? ""}
                    onChange={(e) => handleFieldChange("weight_kg", e.target.value ? parseFloat(e.target.value) : "")}
                    style={fieldInput}
                    className="mt-1 block"
                  />
                </label>
              </div>
            )}

            {selectedType === "treatment" && (
              <div className="flex flex-col gap-3">
                <label className="text-xs font-semibold" style={{ color: "#6B5C4E" }}>
                  Treatment Type *
                  <select value={(details.treatmentType as string) ?? ""} onChange={(e) => handleFieldChange("treatmentType", e.target.value)} style={fieldInput} className="mt-1 block">
                    <option value="">Select...</option>
                    {TREATMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold" style={{ color: "#6B5C4E" }}>
                  Product *
                  <input type="text" value={(details.product as string) ?? ""} onChange={(e) => handleFieldChange("product", e.target.value)} style={fieldInput} className="mt-1 block" />
                </label>
                <label className="text-xs font-semibold" style={{ color: "#6B5C4E" }}>
                  Dose *
                  <input type="text" value={(details.dose as string) ?? ""} onChange={(e) => handleFieldChange("dose", e.target.value)} style={fieldInput} className="mt-1 block" />
                </label>
                <label className="text-xs font-semibold" style={{ color: "#6B5C4E" }}>
                  Withdrawal Days
                  <input type="number" value={(details.withdrawalDays as number) ?? ""} onChange={(e) => handleFieldChange("withdrawalDays", e.target.value ? parseInt(e.target.value) : "")} style={fieldInput} className="mt-1 block" />
                </label>
              </div>
            )}

            {selectedType === "health_issue" && (
              <div className="flex flex-col gap-3">
                <label className="text-xs font-semibold" style={{ color: "#6B5C4E" }}>
                  Symptom *
                  <select value={(details.symptom as string) ?? ""} onChange={(e) => handleFieldChange("symptom", e.target.value)} style={fieldInput} className="mt-1 block">
                    <option value="">Select...</option>
                    {SYMPTOMS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold" style={{ color: "#6B5C4E" }}>
                  Severity *
                  <select value={(details.severity as string) ?? ""} onChange={(e) => handleFieldChange("severity", e.target.value)} style={fieldInput} className="mt-1 block">
                    <option value="">Select...</option>
                    {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              </div>
            )}

            {selectedType === "camp_condition" && (
              <div className="flex flex-col gap-3">
                <label className="text-xs font-semibold" style={{ color: "#6B5C4E" }}>
                  Grazing Quality *
                  <select value={(details.grazingQuality as string) ?? ""} onChange={(e) => handleFieldChange("grazingQuality", e.target.value)} style={fieldInput} className="mt-1 block">
                    <option value="">Select...</option>
                    {GRAZING_QUALITY.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold" style={{ color: "#6B5C4E" }}>
                  Water Status *
                  <select value={(details.waterStatus as string) ?? ""} onChange={(e) => handleFieldChange("waterStatus", e.target.value)} style={fieldInput} className="mt-1 block">
                    <option value="">Select...</option>
                    {WATER_STATUS.map((w) => <option key={w} value={w}>{w}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold" style={{ color: "#6B5C4E" }}>
                  Fence Status *
                  <select value={(details.fenceStatus as string) ?? ""} onChange={(e) => handleFieldChange("fenceStatus", e.target.value)} style={fieldInput} className="mt-1 block">
                    <option value="">Select...</option>
                    {FENCE_STATUS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
              </div>
            )}

            {selectedType === "reproduction" && (
              <div className="flex flex-col gap-3">
                <label className="text-xs font-semibold" style={{ color: "#6B5C4E" }}>
                  Event Type *
                  <select value={(details.eventType as string) ?? ""} onChange={(e) => handleFieldChange("eventType", e.target.value)} style={fieldInput} className="mt-1 block">
                    <option value="">Select...</option>
                    {REPRODUCTION_EVENTS.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
                  </select>
                </label>
              </div>
            )}

            {selectedType === "death" && (
              <div className="flex flex-col gap-3">
                <label className="text-xs font-semibold" style={{ color: "#6B5C4E" }}>
                  Cause *
                  <select value={(details.cause as string) ?? ""} onChange={(e) => handleFieldChange("cause", e.target.value)} style={fieldInput} className="mt-1 block">
                    <option value="">Select...</option>
                    {DEATH_CAUSES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
            )}

            {error && <p className="text-xs" style={{ color: "#C0574C" }}>{error}</p>}

            {/* Actions */}
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => { setStep("type"); setSelectedType(null); setDetails({}); }}
                className="px-4 py-2 text-sm rounded-xl transition-colors"
                style={{ color: "#6B5C4E", border: "1px solid #E0D5C8", background: "transparent" }}
              >
                ← Back
              </button>
              <div className="flex gap-2">
                <button
                  onClick={onCancel}
                  className="px-4 py-2 text-sm rounded-xl transition-colors"
                  style={{ color: "#6B5C4E", border: "1px solid #E0D5C8", background: "transparent" }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={saving || !campId}
                  className="px-4 py-2 text-sm rounded-xl transition-colors disabled:opacity-50"
                  style={{ background: "#4A7C59", color: "#F5EBD4" }}
                >
                  {saving ? "Saving..." : "Create"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
