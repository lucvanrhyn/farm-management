"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
  display: "block" as const,
  fontSize: 12,
  fontWeight: 600,
  color: "#6B5C4E",
  marginBottom: 4,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
};

interface Props {
  farmSlug: string;
  camps: Array<{ camp_id: string; camp_name: string }>;
}

export default function RainfallEntryForm({ farmSlug, camps }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    date: new Date().toISOString().split("T")[0],
    rainfallMm: "",
    campId: "",
    stationName: "",
  });

  function set(field: keyof typeof form) {
    return (
      e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
    ) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/${farmSlug}/rainfall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: form.date,
          rainfallMm: form.rainfallMm,
          campId: form.campId || null,
          stationName: form.stationName.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to save rainfall record.");
        return;
      }

      setForm({
        date: new Date().toISOString().split("T")[0],
        rainfallMm: "",
        campId: "",
        stationName: "",
      });
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-6">
      <button
        onClick={() => {
          setOpen((o) => !o);
          setError(null);
        }}
        className="text-sm px-4 py-2 rounded-lg font-medium transition-opacity hover:opacity-80"
        style={{ background: "#4A90D9", color: "#FFFFFF", border: "none" }}
      >
        {open ? "Cancel" : "+ Record Rainfall"}
      </button>

      {open && (
        <form
          onSubmit={handleSubmit}
          className="mt-4 p-5 rounded-2xl"
          style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
        >
          <h3
            className="text-sm font-semibold mb-4"
            style={{ color: "#1C1815" }}
          >
            New Rainfall Record
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label style={LABEL_STYLE}>Date *</label>
              <input
                required
                type="date"
                value={form.date}
                onChange={set("date")}
                style={FIELD_STYLE}
              />
            </div>
            <div>
              <label style={LABEL_STYLE}>Rainfall (mm) *</label>
              <input
                required
                type="number"
                min="0"
                step="0.1"
                value={form.rainfallMm}
                onChange={set("rainfallMm")}
                placeholder="e.g. 12.5"
                style={FIELD_STYLE}
              />
            </div>
            <div>
              <label style={LABEL_STYLE}>Camp</label>
              <select value={form.campId} onChange={set("campId")} style={FIELD_STYLE}>
                <option value="">Farm-wide</option>
                {camps.map((c) => (
                  <option key={c.camp_id} value={c.camp_id}>
                    {c.camp_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={LABEL_STYLE}>Station Name</label>
              <input
                value={form.stationName}
                onChange={set("stationName")}
                placeholder="e.g. Main gauge"
                style={FIELD_STYLE}
              />
            </div>
          </div>

          {error && (
            <p className="mt-3 text-xs" style={{ color: "#C0574C" }}>
              {error}
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="text-sm px-4 py-2 rounded-lg font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ background: "#4A90D9", color: "#FFFFFF" }}
            >
              {saving ? "Saving\u2026" : "Save Record"}
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
