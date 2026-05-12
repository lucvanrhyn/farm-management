"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFarmModeSafe, type FarmMode } from "@/lib/farm-mode";

const FIELD_STYLE = {
  background: "#FAFAF8",
  border: "1px solid #D8CFC4",
  borderRadius: 8,
  color: "#1C1815",
  fontSize: 14,
  padding: "8px 12px",
  width: "100%",
  outline: "none",
} as const;

const LABEL_STYLE = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#6B5C4E",
  marginBottom: 4,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
};

const SPECIES_LABELS: Record<FarmMode, string> = {
  cattle: "Cattle",
  sheep: "Sheep",
  game: "Game",
};

export default function AddCampForm() {
  const router = useRouter();
  // Issue #232 — read the active mode + enabled species from FarmModeProvider.
  // useFarmModeSafe returns defaults (cattle only, single-species) when used
  // outside a provider, so the component degrades gracefully on legacy mounts.
  const { mode, enabledModes, isMultiMode } = useFarmModeSafe();

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    campId: "",
    campName: "",
    sizeHectares: "",
    waterSource: "",
  });

  // Picker default mirrors current FarmMode, but on a multi-species farm the
  // user MUST acknowledge by interacting with the radio group before the form
  // accepts a submit. `speciesTouched=false` blocks submit on multi-species
  // farms — see "default-but-must-confirm" in #232.
  const [species, setSpecies] = useState<FarmMode>(mode);
  const [speciesTouched, setSpeciesTouched] = useState(false);

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function onSpeciesChange(next: FarmMode) {
    setSpecies(next);
    setSpeciesTouched(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Single-species farms (e.g. Basson — cattle only): picker is hidden and
    // there's only one valid choice, so no acknowledgement step is required.
    // Multi-species farms: the user must have touched the species control.
    if (isMultiMode && !speciesTouched) {
      setError("Please confirm species before saving.");
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        campId: form.campId.trim(),
        campName: form.campName.trim(),
        species,
      };
      if (form.sizeHectares) body.sizeHectares = parseFloat(form.sizeHectares);
      if (form.waterSource) body.waterSource = form.waterSource.trim();

      const res = await fetch("/api/camps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        // Surface the typed-error code (e.g. MISSING_SPECIES) so the user
        // can tell omitted-species from a generic validation failure.
        setError(data.error ?? data.message ?? "Failed to create camp.");
        return;
      }

      setForm({ campId: "", campName: "", sizeHectares: "", waterSource: "" });
      setSpecies(mode);
      setSpeciesTouched(false);
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-6">
      <button
        onClick={() => { setOpen((o) => !o); setError(null); }}
        className="text-sm px-4 py-2 rounded-lg font-medium transition-opacity hover:opacity-80"
        style={{ background: "#4A7C59", color: "#FFFFFF", border: "none" }}
      >
        {open ? "Cancel" : "+ Add Camp"}
      </button>

      {open && (
        <form
          onSubmit={handleSubmit}
          className="mt-4 p-5 rounded-2xl"
          style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
        >
          <h3 className="text-sm font-semibold mb-4" style={{ color: "#1C1815" }}>New Camp</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label style={LABEL_STYLE}>Camp ID *</label>
              <input
                required
                value={form.campId}
                onChange={set("campId")}
                placeholder="e.g. K1"
                style={FIELD_STYLE}
              />
            </div>
            <div>
              <label style={LABEL_STYLE}>Camp Name *</label>
              <input
                required
                value={form.campName}
                onChange={set("campName")}
                placeholder="e.g. Kamp 1"
                style={FIELD_STYLE}
              />
            </div>
            <div>
              <label style={LABEL_STYLE}>Size (ha)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={form.sizeHectares}
                onChange={set("sizeHectares")}
                placeholder="e.g. 45.5"
                style={FIELD_STYLE}
              />
            </div>
            <div>
              <label style={LABEL_STYLE}>Water Source</label>
              <input
                value={form.waterSource}
                onChange={set("waterSource")}
                placeholder="e.g. Borehole"
                style={FIELD_STYLE}
              />
            </div>
          </div>

          {/*
            Species picker — multi-species farms only. Single-species farms
            (Basson cattle-only) get a hidden input so the POST payload still
            carries `species`, satisfying the server-side 422 MISSING_SPECIES
            guard without an unnecessary UI step. (#232 AC #4)
          */}
          {isMultiMode ? (
            <fieldset className="mt-4" style={{ border: "none", padding: 0, margin: 0 }}>
              <legend style={LABEL_STYLE}>Species *</legend>
              <div className="flex gap-3 flex-wrap">
                {enabledModes.map((s) => (
                  <label
                    key={s}
                    className="inline-flex items-center gap-2 cursor-pointer text-sm"
                    style={{ color: "#1C1815" }}
                  >
                    <input
                      type="radio"
                      name="species"
                      value={s}
                      checked={species === s}
                      onChange={() => onSpeciesChange(s)}
                      // Clicking the already-checked radio also counts as an
                      // explicit acknowledgement — browsers don't fire
                      // `onChange` when the value is unchanged.
                      onClick={() => setSpeciesTouched(true)}
                    />
                    {SPECIES_LABELS[s]}
                  </label>
                ))}
              </div>
              {!speciesTouched && (
                <p
                  className="mt-2 text-xs"
                  style={{ color: "#9C8E7A" }}
                  data-testid="species-confirm-hint"
                >
                  Please confirm species before saving.
                </p>
              )}
            </fieldset>
          ) : (
            <input type="hidden" name="species" value={species} />
          )}

          {error && (
            <p className="mt-3 text-xs" style={{ color: "#C0574C" }}>{error}</p>
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="text-sm px-4 py-2 rounded-lg font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ background: "#4A7C59", color: "#FFFFFF" }}
            >
              {saving ? "Saving…" : "Save Camp"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm px-4 py-2 rounded-lg transition-opacity hover:opacity-70"
              style={{ background: "#F0EBE3", color: "#6B5C4E" }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
