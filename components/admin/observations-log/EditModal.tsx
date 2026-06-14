// components/admin/observations-log/EditModal.tsx
// Modal for editing or deleting a single observation. Uses TypeFields
// to render the per-type input form; falls back to ReadOnlyDetails for
// observation types not in EDITABLE_TYPES.

"use client";

import { useState } from "react";
import type { PrismaObservation } from "@/lib/types";
import { safeParse } from "./parseDetails";
import {
  getObservationDetailsForm,
  getObservationTypeLabel,
  isObservationEditable,
} from "./registry";

export interface EditModalProps {
  obs: PrismaObservation;
  onClose: () => void;
  onSaved: (updated: PrismaObservation) => void;
  onDeleted: (id: string) => void;
}

export function EditModal({ obs, onClose, onSaved, onDeleted }: EditModalProps) {
  const parsed = safeParse(obs.details);
  const [details, setDetails] = useState<Record<string, unknown>>(parsed);
  // Issue #492 — editable free-text note, seeded from the existing column.
  const [notes, setNotes] = useState<string>(obs.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isEditable = isObservationEditable(obs.type);
  const DetailsForm = getObservationDetailsForm(obs.type);

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
        // Issue #492 — send `notes` alongside `details`. A blank textarea
        // sends null (clears the note); the edit door trims + caps it.
        body: JSON.stringify({
          details: JSON.stringify(details),
          notes: notes.trim() === "" ? null : notes,
        }),
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
        style={{ background: "var(--ft-surface)", border: "1px solid var(--ft-border)" }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold" style={{ color: "var(--ft-text)" }}>Edit Observation</h3>
          <button
            onClick={onClose}
            className="text-xl leading-none transition-opacity hover:opacity-70"
            style={{ color: "var(--ft-subtle)" }}
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: "var(--ft-subtle)" }}>
          <span><span className="font-semibold" style={{ color: "var(--ft-muted)" }}>Type:</span> {getObservationTypeLabel(obs.type)}</span>
          <span><span className="font-semibold" style={{ color: "var(--ft-muted)" }}>Camp:</span> {obs.campId}</span>
          <span><span className="font-semibold" style={{ color: "var(--ft-muted)" }}>Date:</span> {obs.observedAt.split("T")[0]}</span>
          {obs.animalId && <span><span className="font-semibold" style={{ color: "var(--ft-muted)" }}>Animal:</span> {obs.animalId}</span>}
          {obs.loggedBy && <span><span className="font-semibold" style={{ color: "var(--ft-muted)" }}>Logged by:</span> {obs.loggedBy}</span>}
        </div>

        <div>
          <label className="block text-xs font-semibold mb-2" style={{ color: "var(--ft-subtle)" }}>
            {isEditable ? "Details" : "Details (read-only)"}
          </label>
          <DetailsForm details={details} onChange={handleFieldChange} />
        </div>

        {/* Issue #492 — free-text note. Editable on every observation type
            (cross-cutting, independent of the per-type structured fields), so
            it is rendered even when the structured `details` are read-only. */}
        <div>
          <label
            htmlFor="observation-notes"
            className="block text-xs font-semibold mb-2"
            style={{ color: "var(--ft-subtle)" }}
          >
            Notes (optional)
          </label>
          <textarea
            id="observation-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Free-text note — e.g. “coughing in camp 3”"
            className="w-full rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
            style={{ background: "var(--ft-surface)", border: "1px solid var(--ft-border)", color: "var(--ft-text)" }}
          />
        </div>

        {error && <p className="text-xs" style={{ color: "var(--ft-poor)" }}>{error}</p>}

        <div className="flex items-center justify-between gap-2">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-4 py-2 text-sm rounded-xl transition-colors disabled:opacity-50"
            style={{
              color: confirmDelete ? "#FFFFFF" : "var(--ft-poor)",
              border: "1px solid var(--ft-poor)",
              background: confirmDelete ? "var(--ft-poor)" : "transparent",
            }}
          >
            {deleting ? "Deleting..." : confirmDelete ? "Confirm Delete" : "Delete"}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-xl transition-colors"
              style={{
                color: "var(--ft-muted)",
                border: "1px solid var(--ft-border)",
                background: "transparent",
              }}
            >
              Cancel
            </button>
            {/* Issue #492 — Save is always available now: even when the
                per-type structured `details` are read-only, the cross-cutting
                free-text note can still be edited + saved. For read-only types
                the DetailsForm renders unchanged values, so a save persists
                only the note. */}
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-xl transition-colors disabled:opacity-50"
              style={{ background: "var(--ft-good)", color: "var(--ft-fair-bg)" }}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
