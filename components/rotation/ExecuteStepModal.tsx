"use client";

import { useState } from "react";
import type { RotationStep, PlanCamp, PlanMob } from "./types";

interface Props {
  step: RotationStep;
  camps: PlanCamp[];
  mobs: PlanMob[];
  /** Previous step's destCamp — narrows the mob picker when step.mobId is null */
  prevStepCampId?: string;
  onExecute: (stepId: string, mobId: string) => Promise<void>;
  onClose: () => void;
}

export default function ExecuteStepModal({
  step,
  camps,
  mobs,
  prevStepCampId,
  onExecute,
  onClose,
}: Props) {
  const targetCamp = camps.find((c) => c.campId === step.campId);

  // If step already has a mob, confirm mode; else mob-picker mode
  const preselectedMob = mobs.find((m) => m.id === step.mobId);

  // Narrow mob list: prefer mobs in the previous step's camp; fallback all mobs not in target
  const relevantMobs = step.mobId
    ? []
    : mobs.filter((m) => {
        if (prevStepCampId) return m.currentCamp === prevStepCampId;
        return m.currentCamp !== step.campId;
      });

  const [selectedMobId, setSelectedMobId] = useState(
    preselectedMob?.id ?? relevantMobs[0]?.id ?? "",
  );
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!selectedMobId) return;
    setExecuting(true);
    setError(null);
    try {
      await onExecute(step.id, selectedMobId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Execution failed");
      setExecuting(false);
    }
  }

  const confirmMobName = preselectedMob?.name ?? mobs.find((m) => m.id === selectedMobId)?.name;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <h2 className="text-lg font-semibold mb-2" style={{ color: "#1C1815" }}>
          Execute step
        </h2>
        <p className="text-sm mb-4" style={{ color: "#9C8E7A" }}>
          Move mob into <strong style={{ color: "#3D3530" }}>{targetCamp?.campName ?? step.campId}</strong>.
          This action is permanent.
        </p>

        {!preselectedMob && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1" style={{ color: "#3D3530" }}>
              Select mob to move
            </label>
            {relevantMobs.length === 0 ? (
              <p className="text-sm" style={{ color: "#C0392B" }}>
                No mobs available in the expected source camp. Choose below.
              </p>
            ) : null}
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
              value={selectedMobId}
              onChange={(e) => setSelectedMobId(e.target.value)}
            >
              {(relevantMobs.length > 0 ? relevantMobs : mobs.filter((m) => m.currentCamp !== step.campId)).map(
                (m) => {
                  const campLabel = camps.find((c) => c.campId === m.currentCamp)?.campName ?? m.currentCamp;
                  return (
                    <option key={m.id} value={m.id}>
                      {m.name} (in {campLabel})
                    </option>
                  );
                },
              )}
            </select>
          </div>
        )}

        {error && (
          <p className="text-sm mb-3 font-medium" style={{ color: "#C0392B" }}>
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border text-sm font-medium"
            style={{ color: "#3D3530" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={executing || !selectedMobId}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "#3A6B49" }}
          >
            {executing ? "Moving…" : `Move ${confirmMobName ?? "mob"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
