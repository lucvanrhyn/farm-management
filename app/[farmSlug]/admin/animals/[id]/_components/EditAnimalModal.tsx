"use client";

// Edit-animal modal — Codex audit E1 (2026-05-10): the admin animal detail
// page used to be entirely read-only with only Sell/Death actions. PATCH
// /api/animals/[id] already accepts every identity field for ADMIN, so the
// gap was purely UI. This modal surfaces the editable identity fields and
// dispatches a PATCH with only the fields the user actually changed.

import { useState } from "react";
import type { Animal, Camp } from "@prisma/client";
import { useRouter } from "next/navigation";

interface Props {
  animal: Animal;
  camps: Camp[];
  open: boolean;
  onClose: () => void;
  onSaved: (updated: Animal) => void;
}

// Subset of `Animal` that this modal lets users edit. Status/category/sex
// transitions are intentionally NOT here — Sell/Death go through
// AnimalActions, and category/sex are derived from species defaults.
type EditableFields = Pick<
  Animal,
  | "name"
  | "breed"
  | "dateOfBirth"
  | "currentCamp"
  | "tagNumber"
  | "brandSequence"
  | "registrationNumber"
  | "motherId"
  | "fatherId"
>;

const FIELDS: ReadonlyArray<keyof EditableFields> = [
  "name",
  "breed",
  "dateOfBirth",
  "currentCamp",
  "tagNumber",
  "brandSequence",
  "registrationNumber",
  "motherId",
  "fatherId",
];

function emptyToNull(v: string): string | null {
  return v.trim() === "" ? null : v;
}

export default function EditAnimalModal({
  animal,
  camps,
  open,
  onClose,
  onSaved,
}: Props) {
  const router = useRouter();
  const [form, setForm] = useState<Record<keyof EditableFields, string>>({
    name: animal.name ?? "",
    breed: animal.breed ?? "",
    dateOfBirth: animal.dateOfBirth ?? "",
    currentCamp: animal.currentCamp ?? "",
    tagNumber: animal.tagNumber ?? "",
    brandSequence: animal.brandSequence ?? "",
    registrationNumber: animal.registrationNumber ?? "",
    motherId: animal.motherId ?? "",
    fatherId: animal.fatherId ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function setField(key: keyof EditableFields, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Only send fields the user actually changed. The PATCH endpoint
    // accepts partial updates and re-runs validation on every key it
    // receives (cross-species parent guard, camp-guard); narrowing the
    // body avoids triggering those guards for fields the user didn't
    // touch.
    const patch: Record<string, string | null> = {};
    for (const key of FIELDS) {
      const original = (animal[key] as string | null) ?? "";
      const next = form[key];
      if (next !== original) {
        // Empty string maps to null on the server side for nullable cols.
        patch[key] = emptyToNull(next);
      }
    }

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/animals/${animal.animalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Save failed (${res.status})`);
        return;
      }
      const updated = (await res.json()) as Animal;
      onSaved(updated);
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <h2 className="text-lg font-bold text-stone-900">
          Edit animal — <span className="font-mono">{animal.animalId}</span>
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field
            id="edit-animal-name"
            label="Name"
            value={form.name}
            onChange={(v) => setField("name", v)}
            placeholder="Optional"
          />
          <Field
            id="edit-animal-breed"
            label="Breed"
            value={form.breed}
            onChange={(v) => setField("breed", v)}
          />
          <Field
            id="edit-animal-dob"
            label="Date of birth"
            type="date"
            value={form.dateOfBirth}
            onChange={(v) => setField("dateOfBirth", v)}
          />
          <div>
            <label
              htmlFor="edit-animal-camp"
              className="text-xs text-stone-500 mb-1 block"
            >
              Current camp
            </label>
            <select
              id="edit-animal-camp"
              value={form.currentCamp}
              onChange={(e) => setField("currentCamp", e.target.value)}
              className="w-full border border-stone-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              {camps.map((c) => (
                <option key={c.campId} value={c.campId}>
                  {c.campName}
                </option>
              ))}
            </select>
          </div>
          <Field
            id="edit-animal-tag"
            label="Tag number"
            value={form.tagNumber}
            onChange={(v) => setField("tagNumber", v)}
          />
          <Field
            id="edit-animal-brand"
            label="Brand sequence"
            value={form.brandSequence}
            onChange={(v) => setField("brandSequence", v)}
          />
          <Field
            id="edit-animal-reg"
            label="Studbook / registration nr"
            value={form.registrationNumber}
            onChange={(v) => setField("registrationNumber", v)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field
              id="edit-animal-mother"
              label="Mother ID"
              value={form.motherId}
              onChange={(v) => setField("motherId", v)}
              placeholder="Optional"
            />
            <Field
              id="edit-animal-father"
              label="Sire ID"
              value={form.fatherId}
              onChange={(v) => setField("fatherId", v)}
              placeholder="Optional"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-xl border border-stone-300 text-sm text-stone-600 hover:bg-stone-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2 rounded-xl bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-xs text-stone-500 mb-1 block">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-stone-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
      />
    </div>
  );
}
