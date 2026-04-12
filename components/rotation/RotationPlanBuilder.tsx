"use client";

import { useState } from "react";
import { Plus, Trash2, Archive, Play } from "lucide-react";
import type { RotationPlan, RotationStep, PlanCamp, PlanMob, CampRotationInfo } from "./types";
import RotationStepRow from "./RotationStepRow";
import AddStepModal from "./AddStepModal";

interface Props {
  plan: RotationPlan;
  camps: PlanCamp[];
  mobs: PlanMob[];
  rotationByCampId: Record<string, CampRotationInfo>;
  farmSlug: string;
  onPlanUpdated: (plan: RotationPlan) => void;
  onPlanDeleted: (planId: string) => void;
}

const STATUS_CHIP: Record<string, { label: string; bg: string; color: string }> = {
  draft:     { label: "Draft",     bg: "#F5F5F5", color: "#9C8E7A" },
  active:    { label: "Active",    bg: "#E8F5E9", color: "#2E7D32" },
  completed: { label: "Completed", bg: "#E3F2FD", color: "#1565C0" },
  archived:  { label: "Archived",  bg: "#FAFAFA", color: "#BDBDBD" },
};

/**
 * Recompute planned start dates for pending steps only.
 * Executed/skipped steps keep their original plannedStart unchanged.
 * The cursor starts at planStartDate and advances through all steps sequentially.
 */
function recomputeStarts(steps: RotationStep[], planStartDate: string): RotationStep[] {
  let cursor = new Date(planStartDate);
  return steps.map((s) => {
    const start = cursor.toISOString();
    cursor = new Date(cursor.getTime() + s.plannedDays * 86400000);
    // Keep original plannedStart for completed steps — only update pending ones
    if (s.status !== "pending") return s;
    return { ...s, plannedStart: start };
  });
}

export default function RotationPlanBuilder({
  plan,
  camps,
  mobs,
  rotationByCampId,
  farmSlug,
  onPlanUpdated,
  onPlanDeleted,
}: Props) {
  const [steps, setSteps] = useState<RotationStep[]>(plan.steps);
  const [showAdd, setShowAdd] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const chip = STATUS_CHIP[plan.status] ?? STATUS_CHIP.draft;

  // Default plannedStart for a new step = day after last step ends
  const lastStep = steps[steps.length - 1];
  const defaultNextStart = lastStep
    ? new Date(
        new Date(lastStep.plannedStart).getTime() + lastStep.plannedDays * 86400000,
      ).toISOString()
    : plan.startDate;

  async function reorderSteps(newOrder: RotationStep[]) {
    const previous = steps;
    const recomputed = recomputeStarts(newOrder, plan.startDate);
    setSteps(recomputed);
    // Only send pending step IDs — server validates against pending steps only
    const order = recomputed.filter((s) => s.status === "pending").map((s) => s.id);
    const res = await fetch(`/api/${farmSlug}/rotation/plans/${plan.id}/steps`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    });
    if (!res.ok) {
      // Roll back optimistic update on failure
      setSteps(previous);
    }
  }

  function moveStepUp(idx: number) {
    // Find the previous pending step and swap with it
    const prevPendingIdx = steps.slice(0, idx).map((s, i) => ({ s, i })).filter(({ s }) => s.status === "pending").pop()?.i;
    if (prevPendingIdx === undefined) return;
    const next = [...steps];
    [next[prevPendingIdx], next[idx]] = [next[idx], next[prevPendingIdx]];
    void reorderSteps(next);
  }

  function moveStepDown(idx: number) {
    // Find the next pending step and swap with it
    const nextPendingEntry = steps.slice(idx + 1).map((s, i) => ({ s, i: i + idx + 1 })).find(({ s }) => s.status === "pending");
    if (!nextPendingEntry) return;
    const next = [...steps];
    [next[idx], next[nextPendingEntry.i]] = [next[nextPendingEntry.i], next[idx]];
    void reorderSteps(next);
  }

  async function addStep(data: {
    campId: string;
    mobId: string | null;
    plannedStart: string;
    plannedDays: number;
    notes: string | null;
  }) {
    const res = await fetch(`/api/${farmSlug}/rotation/plans/${plan.id}/steps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to add step");
    const step = (await res.json()) as RotationStep;
    setSteps((prev) => [...prev, step]);
  }

  async function handleActivate() {
    setActionError(null);
    const res = await fetch(`/api/${farmSlug}/rotation/plans/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: plan.status === "active" ? "draft" : "active" }),
    });
    if (!res.ok) { setActionError("Failed to update plan status"); return; }
    const updated = (await res.json()) as RotationPlan;
    onPlanUpdated(updated);
  }

  async function handleArchive() {
    setActionError(null);
    const res = await fetch(`/api/${farmSlug}/rotation/plans/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    if (!res.ok) { setActionError("Failed to archive plan"); return; }
    const updated = (await res.json()) as RotationPlan;
    onPlanUpdated(updated);
  }

  async function handleDelete() {
    if (!confirm(`Delete plan "${plan.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    setActionError(null);
    const res = await fetch(`/api/${farmSlug}/rotation/plans/${plan.id}`, { method: "DELETE" });
    if (res.ok) {
      onPlanDeleted(plan.id);
    } else {
      setActionError("Failed to delete plan");
    }
    setDeleting(false);
  }

  function handleStepExecuted(updatedStep: RotationStep) {
    setSteps((prev) => prev.map((s) => (s.id === updatedStep.id ? updatedStep : s)));
  }

  const pendingSteps = steps.filter((s) => s.status === "pending");
  const firstPendingIdx = steps.findIndex((s) => s.status === "pending");
  const lastPendingIdx = steps.reduce((last, s, i) => (s.status === "pending" ? i : last), -1);

  return (
    <div className="space-y-4">
      {/* Plan header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold" style={{ color: "#1C1815" }}>
              {plan.name}
            </h2>
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: chip.bg, color: chip.color }}
            >
              {chip.label}
            </span>
          </div>
          <p className="text-sm mt-0.5" style={{ color: "#9C8E7A" }}>
            From {new Date(plan.startDate).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
            {" · "}
            {steps.length} step{steps.length !== 1 ? "s" : ""}
            {pendingSteps.length > 0 && `, ${pendingSteps.length} pending`}
          </p>
        </div>
        <div className="flex gap-2">
          {plan.status !== "archived" && (
            <>
              <button
                onClick={handleActivate}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm font-medium"
                style={{ color: "#3A6B49", borderColor: "#3A6B49" }}
              >
                <Play size={14} />
                {plan.status === "active" ? "Deactivate" : "Activate"}
              </button>
              <button
                onClick={handleArchive}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm font-medium"
                style={{ color: "#9C8E7A", borderColor: "#E8E0D8" }}
              >
                <Archive size={14} />
                Archive
              </button>
            </>
          )}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm font-medium disabled:opacity-50"
            style={{ color: "#C0392B", borderColor: "#FADBD8" }}
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      </div>

      {actionError && (
        <p className="text-xs font-medium px-1" style={{ color: "#C0392B" }}>
          {actionError}
        </p>
      )}

      {/* Steps list */}
      <div className="space-y-2">
        {steps.length === 0 && (
          <p className="text-sm py-4 text-center" style={{ color: "#9C8E7A" }}>
            No steps yet. Add the first camp to rotate into.
          </p>
        )}
        {steps.map((step, idx) => (
          <RotationStepRow
            key={step.id}
            step={step}
            index={idx}
            camps={camps}
            mobs={mobs}
            rotationByCampId={rotationByCampId}
            isFirstPending={idx === firstPendingIdx}
            isLastPending={idx === lastPendingIdx}
            prevStepCampId={idx > 0 ? steps[idx - 1].campId : undefined}
            farmSlug={farmSlug}
            onMoveUp={() => moveStepUp(idx)}
            onMoveDown={() => moveStepDown(idx)}
            onExecuted={handleStepExecuted}
          />
        ))}
      </div>

      {plan.status !== "archived" && (
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium"
          style={{ color: "#3A6B49", borderColor: "#3A6B49" }}
        >
          <Plus size={16} />
          Add step
        </button>
      )}

      {showAdd && (
        <AddStepModal
          camps={camps}
          mobs={mobs}
          rotationByCampId={rotationByCampId}
          defaultPlannedStart={defaultNextStart}
          onAdd={addStep}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}
