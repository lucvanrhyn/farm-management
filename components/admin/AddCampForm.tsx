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
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#6B5C4E",
  marginBottom: 4,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
};

export default function AddCampForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    campId: "",
    campName: "",
    sizeHectares: "",
    waterSource: "",
  });

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        campId: form.campId.trim(),
        campName: form.campName.trim(),
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
        setError(data.error ?? "Failed to create camp.");
        return;
      }

      setForm({ campId: "", campName: "", sizeHectares: "", waterSource: "" });
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
