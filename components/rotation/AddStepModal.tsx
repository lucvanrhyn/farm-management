"use client";

import { useState } from "react";
import type { PlanCamp, PlanMob, CampRotationInfo } from "./types";

interface Props {
  camps: PlanCamp[];
  mobs: PlanMob[];
  rotationByCampId: Record<string, CampRotationInfo>;
  defaultPlannedStart: string; // ISO date string — pre-computed by parent
  onAdd: (step: {
    campId: string;
    mobId: string | null;
    plannedStart: string;
    plannedDays: number;
    notes: string | null;
  }) => Promise<void>;
  onClose: () => void;
}

export default function AddStepModal({
  camps,
  mobs,
  rotationByCampId,
  defaultPlannedStart,
  onAdd,
  onClose,
}: Props) {
  const [campId, setCampId] = useState(camps[0]?.campId ?? "");
  const [mobId, setMobId] = useState("");
  const [plannedStart, setPlannedStart] = useState(
    defaultPlannedStart.slice(0, 10),
  );
  const [plannedDays, setPlannedDays] = useState<number>(
    rotationByCampId[campId]?.effectiveMaxGrazingDays ?? 7,
  );
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCampChange(newCampId: string) {
    setCampId(newCampId);
    const campInfo = rotationByCampId[newCampId];
    if (campInfo) setPlannedDays(campInfo.effectiveMaxGrazingDays);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!campId || !plannedStart || plannedDays < 1) return;
    setSaving(true);
    setError(null);
    try {
      await onAdd({
        campId,
        mobId: mobId || null,
        plannedStart: new Date(plannedStart).toISOString(),
        plannedDays,
        notes: notes.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add step");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <h2 className="text-lg font-semibold mb-4" style={{ color: "#1C1815" }}>
          Add Step
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "#3D3530" }}>
              Camp
            </label>
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={campId}
              onChange={(e) => handleCampChange(e.target.value)}
              required
            >
              {camps.map((c) => (
                <option key={c.campId} value={c.campId}>
                  {c.campName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "#3D3530" }}>
              Mob <span className="font-normal text-xs" style={{ color: "#9C8E7A" }}>(optional — can be assigned at execution)</span>
            </label>
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={mobId}
              onChange={(e) => setMobId(e.target.value)}
            >
              <option value="">Any ready mob</option>
              {mobs.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "#3D3530" }}>
                Planned start
              </label>
              <input
                type="date"
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={plannedStart}
                onChange={(e) => setPlannedStart(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "#3D3530" }}>
                Days
              </label>
              <input
                type="number"
                min={1}
                max={365}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={plannedDays}
                onChange={(e) => setPlannedDays(Number(e.target.value))}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "#3D3530" }}>
              Notes <span className="font-normal text-xs" style={{ color: "#9C8E7A" }}>(optional)</span>
            </label>
            <input
              type="text"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. wait for rain"
            />
          </div>

          {error && (
            <p className="text-xs font-medium" style={{ color: "#C0392B" }}>
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border text-sm font-medium"
              style={{ color: "#3D3530" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "#3A6B49" }}
            >
              {saving ? "Adding…" : "Add step"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
