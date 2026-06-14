"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import TypedConfirm from "./TypedConfirm";

export interface CampRow {
  camp_id: string;
  camp_name: string;
  water_source?: string;
  sizeHectares?: number;
  color?: string;
  liveCount: number;
  grazing: string;
  fence: string;
  lastDate: string;
  lastBy: string;
  veldType: string | null;
  restDaysOverride: number | null;
  maxGrazingDaysOverride: number | null;
  rotationNotes: string | null;
}

const VELD_TYPES = ["sweetveld", "sourveld", "mixedveld", "cultivated"] as const;

function grazingColor(g: string): { color: string; bg: string } {
  if (g === "Excellent") return { color: "var(--ft-good)", bg: "rgba(74,124,89,0.18)" };
  if (g === "Good")      return { color: "#6B9E5E", bg: "rgba(107,158,94,0.15)" };
  if (g === "Poor")      return { color: "var(--ft-poor)", bg: "rgba(160,82,45,0.18)" };
  return { color: "var(--ft-fair)", bg: "rgba(139,105,20,0.15)" };
}

interface EditForm {
  campName: string;
  sizeHectares: string;
  waterSource: string;
  color: string;
  veldType: string;
  restDaysOverride: string;
  maxGrazingDaysOverride: string;
  rotationNotes: string;
}

const FIELD_STYLE = {
  background: "var(--ft-bg)", border: "1px solid var(--ft-border)", borderRadius: 8,
  color: "var(--ft-text)", fontSize: 13, padding: "6px 10px", width: "100%", outline: "none",
} as const;

const LABEL_STYLE: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600, color: "var(--ft-muted)",
  marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em",
};

export default function CampsTableClient({ rows, farmSlug }: { rows: CampRow[]; farmSlug: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [removeAllError, setRemoveAllError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    campName: "", sizeHectares: "", waterSource: "", color: "",
    veldType: "", restDaysOverride: "", maxGrazingDaysOverride: "", rotationNotes: "",
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function openEdit(row: CampRow) {
    setEditForm({
      campName: row.camp_name,
      sizeHectares: row.sizeHectares !== undefined ? String(row.sizeHectares) : "",
      waterSource: row.water_source ?? "",
      color: row.color ?? "",
      veldType: row.veldType ?? "",
      restDaysOverride: row.restDaysOverride !== null ? String(row.restDaysOverride) : "",
      maxGrazingDaysOverride: row.maxGrazingDaysOverride !== null ? String(row.maxGrazingDaysOverride) : "",
      rotationNotes: row.rotationNotes ?? "",
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
      body.color = editForm.color.trim() || null;
      body.veldType = editForm.veldType || null;
      body.restDaysOverride = editForm.restDaysOverride ? parseInt(editForm.restDaysOverride, 10) : null;
      body.maxGrazingDaysOverride = editForm.maxGrazingDaysOverride
        ? parseInt(editForm.maxGrazingDaysOverride, 10)
        : null;
      body.rotationNotes = editForm.rotationNotes.trim() || null;

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
    setRemoveAllError(null);
    try {
      const res = await fetch("/api/camps/reset", { method: "DELETE" });
      if (!res.ok) {
        const { error } = await res.json() as { error?: string };
        setRemoveAllError(error ?? "Failed to remove camps.");
      } else {
        router.refresh();
      }
    } catch {
      setRemoveAllError("Network error — try again.");
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
            style={{ background: "var(--ft-surface)", border: "1px solid var(--ft-border)", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold" style={{ color: "var(--ft-text)" }}>
                Edit Camp — <span className="font-mono">{editing}</span>
              </h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="text-lg leading-none transition-opacity hover:opacity-60"
                style={{ color: "var(--ft-subtle)" }}
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
                <label style={LABEL_STYLE}>Camp Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={editForm.color || "#94a3b8"}
                    onChange={(e) => setEditForm((f) => ({ ...f, color: e.target.value }))}
                    style={{ width: 36, height: 36, border: "1px solid var(--ft-border)", borderRadius: 6, cursor: "pointer", padding: 2 }}
                  />
                  <span className="text-xs font-mono" style={{ color: "var(--ft-subtle)" }}>{editForm.color || "Auto"}</span>
                </div>
              </div>
            </div>

            {/* Rotation overrides */}
            <div
              className="rounded-lg p-3 space-y-3"
              style={{ background: "var(--ft-bg)", border: "1px solid var(--ft-border)" }}
            >
              <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ft-muted)" }}>
                Rotation Overrides
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label style={LABEL_STYLE}>Veld Type</label>
                  <select
                    value={editForm.veldType}
                    onChange={(e) => setEditForm((f) => ({ ...f, veldType: e.target.value }))}
                    style={FIELD_STYLE}
                  >
                    <option value="">(Inherit from farm)</option>
                    {VELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={LABEL_STYLE}>Rest Days Override</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={editForm.restDaysOverride}
                    onChange={setField("restDaysOverride")}
                    placeholder="(Inherit)"
                    style={FIELD_STYLE}
                  />
                </div>
                <div>
                  <label style={LABEL_STYLE}>Max Grazing Days Override</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={editForm.maxGrazingDaysOverride}
                    onChange={setField("maxGrazingDaysOverride")}
                    placeholder="(Inherit)"
                    style={FIELD_STYLE}
                  />
                </div>
                <div className="col-span-2">
                  <label style={LABEL_STYLE}>Rotation Notes</label>
                  <textarea
                    rows={2}
                    value={editForm.rotationNotes}
                    onChange={setField("rotationNotes")}
                    placeholder="Optional notes about this camp's rotation"
                    style={{ ...FIELD_STYLE, resize: "vertical" as const }}
                  />
                </div>
              </div>
              <p className="text-[11px]" style={{ color: "var(--ft-subtle)" }}>
                Rest Days Override replaces the farm default and disables the seasonal multiplier for this camp.
              </p>
            </div>

            {editError && (
              <p className="text-xs" style={{ color: "var(--ft-poor)" }}>{editError}</p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={editSaving}
                className="text-sm px-4 py-2 rounded-lg font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ background: "var(--ft-good)", color: "#FFFFFF" }}
              >
                {editSaving ? "Saving…" : "Save Changes"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="text-sm px-4 py-2 rounded-lg transition-opacity hover:opacity-70"
                style={{ background: "var(--ft-surface)", color: "var(--ft-muted)" }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div
        className="overflow-x-auto rounded-2xl"
        style={{ background: "var(--ft-surface)", border: "1px solid var(--ft-border)" }}
      >
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm" style={{ color: "var(--ft-subtle)" }}>
            No camps yet. Add your first camp above.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-xs uppercase tracking-wide"
                style={{ borderBottom: "1px solid var(--ft-border)", background: "var(--ft-surface)", color: "var(--ft-subtle)" }}
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
                    style={{ borderBottom: "1px solid var(--ft-border)", opacity: isDeleting ? 0.5 : 1 }}
                  >
                    <td className="px-4 py-3 font-semibold">
                      <div className="flex items-center gap-2">
                        {camp.color && (
                          <span
                            className="inline-block w-3 h-3 rounded-full shrink-0"
                            style={{ background: camp.color }}
                          />
                        )}
                        <Link
                          href={`/${farmSlug}/admin/camps/${camp.camp_id}`}
                          className="transition-colors hover:text-[var(--ft-fair)]"
                          style={{ color: "var(--ft-text)" }}
                        >
                          {camp.camp_name}
                        </Link>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono" style={{ color: "var(--ft-muted)" }}>
                      {camp.liveCount}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs" style={{ color: "var(--ft-subtle)" }}>
                      {camp.sizeHectares && camp.sizeHectares > 0
                        ? (camp.liveCount / camp.sizeHectares).toFixed(1)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 capitalize" style={{ color: "var(--ft-subtle)" }}>
                      {camp.water_source ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: "var(--ft-subtle)" }}>
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
                            ? { background: "rgba(74,124,89,0.18)", color: "var(--ft-good)" }
                            : { background: "rgba(139,20,20,0.2)", color: "var(--ft-poor)" }
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
                          style={{ color: "var(--ft-fair)" }}
                        >
                          Performance →
                        </Link>
                        <button
                          onClick={() => openEdit(camp)}
                          className="text-xs transition-opacity hover:opacity-70"
                          style={{ color: "var(--ft-good)" }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(camp.camp_id, camp.camp_name)}
                          disabled={isDeleting}
                          className="text-xs transition-opacity hover:opacity-70 disabled:opacity-40"
                          style={{ color: "var(--ft-poor)" }}
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

      {/*
        #371 — "Remove All Camps" moved out of the inline table-controls row
        (where it sat next to "+ Add Camp") into a footer-level Danger Zone
        with the shared typed-confirmation gate. No bare window.confirm().
      */}
      {rows.length > 0 && (
        <div
          data-testid="danger-zone"
          className="mt-8 rounded-xl overflow-hidden"
          style={{ border: "1px solid rgba(160,50,50,0.3)", background: "rgba(139,20,20,0.05)" }}
        >
          <div className="flex items-center gap-2 px-4 py-3">
            <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "var(--ft-poor)" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--ft-poor)" }}>Danger Zone</span>
          </div>
          <div
            className="px-4 pb-4 pt-3 flex flex-col gap-3"
            style={{ borderTop: "1px solid rgba(160,50,50,0.2)" }}
          >
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--ft-text)" }}>Remove All Camps</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--ft-subtle)" }}>
                Permanently deletes every camp on this farm. Blocked if any camp still holds active animals.
              </p>
            </div>
            <TypedConfirm
              phrase="REMOVE"
              triggerLabel="Remove All Camps"
              confirmLabel="Confirm Remove"
              busyLabel="Removing..."
              onConfirm={handleRemoveAll}
              error={removeAllError ?? undefined}
            />
          </div>
        </div>
      )}
    </div>
  );
}
