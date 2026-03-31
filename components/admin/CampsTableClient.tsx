"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface CampRow {
  camp_id: string;
  camp_name: string;
  water_source?: string;
  sizeHectares?: number;
  liveCount: number;
  grazing: string;
  fence: string;
  lastDate: string;
  lastBy: string;
}

function grazingColor(g: string): { color: string; bg: string } {
  if (g === "Excellent") return { color: "#4A7C59", bg: "rgba(74,124,89,0.18)" };
  if (g === "Good")      return { color: "#6B9E5E", bg: "rgba(107,158,94,0.15)" };
  if (g === "Poor")      return { color: "#A0522D", bg: "rgba(160,82,45,0.18)" };
  return { color: "#8B6914", bg: "rgba(139,105,20,0.15)" };
}

interface EditForm {
  campName: string;
  sizeHectares: string;
  waterSource: string;
  notes: string;
}

const FIELD_STYLE = {
  background: "#FAFAF8", border: "1px solid #D8CFC4", borderRadius: 8,
  color: "#1C1815", fontSize: 13, padding: "6px 10px", width: "100%", outline: "none",
} as const;

const LABEL_STYLE: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600, color: "#6B5C4E",
  marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em",
};

export default function CampsTableClient({ rows, farmSlug }: { rows: CampRow[]; farmSlug: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ campName: "", sizeHectares: "", waterSource: "", notes: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function openEdit(row: CampRow) {
    setEditForm({
      campName: row.camp_name,
      sizeHectares: row.sizeHectares !== undefined ? String(row.sizeHectares) : "",
      waterSource: row.water_source ?? "",
      notes: "",
    });
    setEditError(null);
    setEditing(row.camp_id);
  }

  function setField(field: keyof EditForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setEditForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const body: Record<string, unknown> = { campName: editForm.campName.trim() };
      body.sizeHectares = editForm.sizeHectares ? parseFloat(editForm.sizeHectares) : null;
      body.waterSource = editForm.waterSource.trim() || null;
      body.notes = editForm.notes.trim() || null;

      const res = await fetch(`/api/camps/${editing}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setEditError(data.error ?? "Failed to update camp.");
        return;
      }

      setEditing(null);
      router.refresh();
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete(campId: string, campName: string) {
    if (!window.confirm(`Delete camp "${campName}"? This cannot be undone.`)) return;
    setDeleting(campId);
    try {
      const res = await fetch(`/api/camps/${campId}`, { method: "DELETE" });
      if (!res.ok) {
        const { error } = await res.json() as { error?: string };
        alert(error ?? "Failed to delete camp.");
      } else {
        router.refresh();
      }
    } finally {
      setDeleting(null);
    }
  }

  async function handleRemoveAll() {
    if (!window.confirm("Remove ALL camps? This cannot be undone.")) return;
    setResetting(true);
    try {
      const res = await fetch("/api/camps/reset", { method: "DELETE" });
      if (!res.ok) {
        const { error } = await res.json() as { error?: string };
        alert(error ?? "Failed to remove camps.");
      } else {
        router.refresh();
      }
    } finally {
      setResetting(false);
    }
  }

  return (
    <div>
      {/* Edit modal */}
      {editing !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(28,24,21,0.6)", backdropFilter: "blur(2px)" }}
        >
          <form
            onSubmit={handleEditSubmit}
            className="w-full max-w-md rounded-2xl p-6 space-y-4"
            style={{ background: "#FFFFFF", border: "1px solid #E0D5C8", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
                Edit Camp — <span className="font-mono">{editing}</span>
              </h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="text-lg leading-none transition-opacity hover:opacity-60"
                style={{ color: "#9C8E7A" }}
              >
                ×
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label style={LABEL_STYLE}>Camp Name *</label>
                <input
                  required
                  value={editForm.campName}
                  onChange={setField("campName")}
                  style={FIELD_STYLE}
                />
              </div>
              <div>
                <label style={LABEL_STYLE}>Size (ha)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={editForm.sizeHectares}
                  onChange={setField("sizeHectares")}
                  placeholder="e.g. 45.5"
                  style={FIELD_STYLE}
                />
              </div>
              <div>
                <label style={LABEL_STYLE}>Water Source</label>
                <input
                  value={editForm.waterSource}
                  onChange={setField("waterSource")}
                  placeholder="e.g. Borehole"
                  style={FIELD_STYLE}
                />
              </div>
              <div className="col-span-2">
                <label style={LABEL_STYLE}>Notes</label>
                <textarea
                  value={editForm.notes}
                  onChange={setField("notes")}
                  rows={2}
                  placeholder="Optional notes"
                  style={{ ...FIELD_STYLE, resize: "vertical" }}
                />
              </div>
            </div>

            {editError && (
              <p className="text-xs" style={{ color: "#C0574C" }}>{editError}</p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={editSaving}
                className="text-sm px-4 py-2 rounded-lg font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ background: "#4A7C59", color: "#FFFFFF" }}
              >
                {editSaving ? "Saving…" : "Save Changes"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="text-sm px-4 py-2 rounded-lg transition-opacity hover:opacity-70"
                style={{ background: "#F0EBE3", color: "#6B5C4E" }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex justify-end mb-3">
          <button
            onClick={handleRemoveAll}
            disabled={resetting}
            className="text-xs px-3 py-1.5 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
            style={{ background: "rgba(192,87,76,0.12)", color: "#C0574C", border: "1px solid rgba(192,87,76,0.25)" }}
          >
            {resetting ? "Removing…" : "Remove All Camps"}
          </button>
        </div>
      )}

      <div
        className="overflow-x-auto rounded-2xl"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm" style={{ color: "#9C8E7A" }}>
            No camps yet. Add your first camp above.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-xs uppercase tracking-wide"
                style={{ borderBottom: "1px solid #E0D5C8", background: "#F5F2EE", color: "#9C8E7A" }}
              >
                <th className="text-left px-4 py-3 font-semibold">Camp</th>
                <th className="text-right px-4 py-3 font-semibold">Animals</th>
                <th className="text-right px-4 py-3 font-semibold">LSU/ha</th>
                <th className="text-left px-4 py-3 font-semibold">Water Source</th>
                <th className="text-left px-4 py-3 font-semibold">Last Inspection</th>
                <th className="text-left px-4 py-3 font-semibold">Grazing</th>
                <th className="text-left px-4 py-3 font-semibold">Fence</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((camp) => {
                const gc = grazingColor(camp.grazing);
                const isDeleting = deleting === camp.camp_id;
                return (
                  <tr
                    key={camp.camp_id}
                    className="admin-row"
                    style={{ borderBottom: "1px solid #E0D5C8", opacity: isDeleting ? 0.5 : 1 }}
                  >
                    <td className="px-4 py-3 font-semibold">
                      <Link
                        href={`/${farmSlug}/admin/camps/${camp.camp_id}`}
                        className="transition-colors hover:text-[#8B6914]"
                        style={{ color: "#1C1815" }}
                      >
                        {camp.camp_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right font-mono" style={{ color: "#6B5C4E" }}>
                      {camp.liveCount}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs" style={{ color: "#9C8E7A" }}>
                      {camp.sizeHectares && camp.sizeHectares > 0
                        ? (camp.liveCount / camp.sizeHectares).toFixed(1)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 capitalize" style={{ color: "#9C8E7A" }}>
                      {camp.water_source ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: "#9C8E7A" }}>
                      {camp.lastDate !== "—" ? `${camp.lastDate} · ${camp.lastBy}` : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ background: gc.bg, color: gc.color }}
                      >
                        {camp.grazing}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
                        style={
                          camp.fence === "Intact"
                            ? { background: "rgba(74,124,89,0.18)", color: "#4A7C59" }
                            : { background: "rgba(139,20,20,0.2)", color: "#C0574C" }
                        }
                      >
                        {camp.fence === "Intact" ? "Intact" : "Damaged"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Link
                          href={`/${farmSlug}/admin/camps/${camp.camp_id}`}
                          className="text-xs transition-opacity hover:opacity-70"
                          style={{ color: "#8B6914" }}
                        >
                          Performance →
                        </Link>
                        <button
                          onClick={() => openEdit(camp)}
                          className="text-xs transition-opacity hover:opacity-70"
                          style={{ color: "#4A7C59" }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(camp.camp_id, camp.camp_name)}
                          disabled={isDeleting}
                          className="text-xs transition-opacity hover:opacity-70 disabled:opacity-40"
                          style={{ color: "#C0574C" }}
                        >
                          {isDeleting ? "…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
