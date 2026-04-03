"use client";

import { useState } from "react";

// kg DM/ha midpoints per category — SA bushveld/Highveld ranges
const CATEGORY_KG_DM: Record<string, number> = {
  Good: 2000,
  Fair: 1100,
  Poor: 450,
};

const DEFAULT_USE_FACTOR = 0.35;
const DAILY_DMI_PER_HEAD = 10;

function calcDays(kgDmPerHa: number, sizeHa: number, headCount: number): number | null {
  if (headCount <= 0 || sizeHa <= 0) return null;
  return Math.round((kgDmPerHa * sizeHa * DEFAULT_USE_FACTOR) / (headCount * DAILY_DMI_PER_HEAD));
}

const CATEGORIES = [
  {
    id: "Good",
    label: "Goed / Good",
    desc: "Thick grass, minimal bare ground",
    range: "≈ 1,500–2,500 kg DM/ha",
    color: "#2A7D4F",
    bg: "#F0FBF5",
    border: "#A8D5BB",
  },
  {
    id: "Fair",
    label: "Matig / Fair",
    desc: "Moderate grass, some bare patches",
    range: "≈ 700–1,500 kg DM/ha",
    color: "#B45309",
    bg: "#FFFBEB",
    border: "#FCD34D",
  },
  {
    id: "Poor",
    label: "Swak / Poor",
    desc: "Sparse grass, significant bare ground",
    range: "≈ 200–700 kg DM/ha",
    color: "#B91C1C",
    bg: "#FFF5F5",
    border: "#FCA5A5",
  },
] as const;

type CategoryId = "Good" | "Fair" | "Poor";

interface Props {
  farmSlug: string;
  campId: string;
  sizeHectares: number | null;
  animalCount: number;
  onSaved?: () => void;
}

export default function CampCoverForm({ farmSlug, campId, sizeHectares, animalCount, onSaved }: Props) {
  const [selected, setSelected] = useState<CategoryId | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const kgDmPreview = selected ? CATEGORY_KG_DM[selected] : null;
  const daysPreview =
    kgDmPreview !== null && sizeHectares
      ? calcDays(kgDmPreview, sizeHectares, animalCount)
      : null;

  async function handleSubmit() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/${farmSlug}/camps/${campId}/cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverCategory: selected }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to save");
      }
      setSaved(true);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "An error occurred");
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <div className="rounded-2xl border p-5 text-center" style={{ background: "#F0FBF5", borderColor: "#A8D5BB" }}>
        <p className="text-sm font-semibold" style={{ color: "#2A7D4F" }}>
          ✓ Cover recorded
          {daysPreview !== null && (
            <span style={{ color: "#1C1815" }}> — est. {daysPreview} days grazing remaining</span>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Category picker */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {CATEGORIES.map((cat) => {
          const isSelected = selected === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setSelected(cat.id)}
              className="rounded-xl border-2 p-4 text-left transition-all"
              style={{
                background: isSelected ? cat.bg : "#FFFFFF",
                borderColor: isSelected ? cat.color : "#E0D5C8",
                boxShadow: isSelected ? `0 0 0 2px ${cat.color}22` : undefined,
              }}
            >
              <p className="font-semibold text-sm" style={{ color: cat.color }}>
                {cat.label}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "#6B5E50" }}>
                {cat.desc}
              </p>
              <p className="text-xs mt-1 font-mono" style={{ color: "#9C8E7A" }}>
                {cat.range}
              </p>
            </button>
          );
        })}
      </div>

      {/* Instant days-remaining feedback */}
      {selected && (
        <div
          className="rounded-xl border px-4 py-3 text-sm"
          style={{ background: "#F7F4F0", borderColor: "#E0D5C8" }}
        >
          {daysPreview !== null ? (
            <span style={{ color: "#1C1815" }}>
              Est.{" "}
              <strong
                style={{
                  color:
                    daysPreview <= 3 ? "#B91C1C" : daysPreview <= 7 ? "#B45309" : "#2A7D4F",
                }}
              >
                {daysPreview} days
              </strong>{" "}
              grazing remaining
              {daysPreview <= 3 && " — move cattle soon"}
              {daysPreview > 3 && daysPreview <= 7 && " — plan your move"}
            </span>
          ) : (
            <span style={{ color: "#9C8E7A" }}>
              {!sizeHectares
                ? "Add camp size (ha) to see days remaining estimate"
                : animalCount === 0
                ? "No active animals — days remaining estimate unavailable"
                : "Cannot calculate days remaining"}
            </span>
          )}
          <p className="text-xs mt-1" style={{ color: "#9C8E7A" }}>
            Formula: cover × {sizeHectares ?? "?"} ha × 35% ÷ ({animalCount} head × 10 kg/day)
          </p>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={!selected || saving}
        className="rounded-xl px-5 py-2 text-sm font-semibold transition-opacity disabled:opacity-40"
        style={{ background: "#1C1815", color: "#FAFAF8" }}
      >
        {saving ? "Saving…" : "Record Cover"}
      </button>
    </div>
  );
}
