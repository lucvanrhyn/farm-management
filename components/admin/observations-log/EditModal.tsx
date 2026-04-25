// components/admin/observations-log/EditModal.tsx
// Modal for editing or deleting a single observation. Uses TypeFields
// to render the per-type input form; falls back to ReadOnlyDetails for
// observation types not in EDITABLE_TYPES.

"use client";

import { useState } from "react";
import type { PrismaObservation } from "@/lib/types";
import { EDITABLE_TYPES, TYPE_LABEL } from "./constants";
import { safeParse } from "./parseDetails";
import { TypeFields } from "./fields";

export interface EditModalProps {
  obs: PrismaObservation;
  onClose: () => void;
  onSaved: (updated: PrismaObservation) => void;
  onDeleted: (id: string) => void;
}

export function EditModal({ obs, onClose, onSaved, onDeleted }: EditModalProps) {
  const parsed = safeParse(obs.details);
  const [details, setDetails] = useState<Record<string, unknown>>(parsed);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isEditable = EDITABLE_TYPES.has(obs.type);

  function handleFieldChange(key: string, value: unknown) {
    setDetails((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/observations/${obs.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ details: JSON.stringify(details) }),
      });
      if (!res.ok) {
        const e = await res.json();
        setError(e.error ?? "Save failed");
        return;
      }
      const updated: PrismaObservation = await res.json();
      onSaved(updated);
      onClose();
    } catch {
      setError("Network error — try again");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/observations/${obs.id}`, { method: "DELETE" });
      if (!res.ok) {
        const e = await res.json();
        setError(e.error ?? "Delete failed");
        return;
      }
      onDeleted(obs.id);
      onClose();
    } catch {
      setError("Network error — try again");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="rounded-2xl w-full max-w-lg mx-4 p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold" style={{ color: "#1C1815" }}>Edit Observation</h3>
          <button
            onClick={onClose}
            className="text-xl leading-none transition-opacity hover:opacity-70"
            style={{ color: "#9C8E7A" }}
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: "#9C8E7A" }}>
          <span><span className="font-semibold" style={{ color: "#6B5C4E" }}>Type:</span> {TYPE_LABEL[obs.type] ?? obs.type}</span>
          <span><span className="font-semibold" style={{ color: "#6B5C4E" }}>Camp:</span> {obs.campId}</span>
          <span><span className="font-semibold" style={{ color: "#6B5C4E" }}>Date:</span> {obs.observedAt.split("T")[0]}</span>
          {obs.animalId && <span><span className="font-semibold" style={{ color: "#6B5C4E" }}>Animal:</span> {obs.animalId}</span>}
          {obs.loggedBy && <span><span className="font-semibold" style={{ color: "#6B5C4E" }}>Logged by:</span> {obs.loggedBy}</span>}
        </div>

        <div>
          <label className="block text-xs font-semibold mb-2" style={{ color: "#9C8E7A" }}>
            {isEditable ? "Details" : "Details (read-only)"}
          </label>
          <TypeFields type={obs.type} details={details} onChange={handleFieldChange} />
        </div>

        {error && <p className="text-xs" style={{ color: "#C0574C" }}>{error}</p>}

        <div className="flex items-center justify-between gap-2">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-4 py-2 text-sm rounded-xl transition-colors disabled:opacity-50"
            style={{
              color: confirmDelete ? "#FFFFFF" : "#C0574C",
              border: "1px solid #C0574C",
              background: confirmDelete ? "#C0574C" : "transparent",
            }}
          >
            {deleting ? "Deleting..." : confirmDelete ? "Confirm Delete" : "Delete"}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-xl transition-colors"
              style={{
                color: "#6B5C4E",
                border: "1px solid #E0D5C8",
                background: "transparent",
              }}
            >
              Cancel
            </button>
            {isEditable && (
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 text-sm rounded-xl transition-colors disabled:opacity-50"
                style={{ background: "#4A7C59", color: "#F5EBD4" }}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
