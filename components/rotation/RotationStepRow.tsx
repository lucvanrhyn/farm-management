"use client";

import { useState } from "react";
import { ChevronUp, ChevronDown, Play } from "lucide-react";
import type { RotationStep, PlanCamp, PlanMob, CampRotationInfo } from "./types";
import ExecuteStepModal from "./ExecuteStepModal";

interface Props {
  step: RotationStep;
  index: number;
  camps: PlanCamp[];
  mobs: PlanMob[];
  rotationByCampId: Record<string, CampRotationInfo>;
  isFirstPending: boolean;
  isLastPending: boolean;
  prevStepCampId?: string;
  farmSlug: string;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onExecuted: (updatedStep: RotationStep) => void;
}

const STATUS_CHIP: Record<string, { label: string; bg: string; color: string }> = {
  pending:  { label: "Pending",  bg: "#F0F4F0", color: "#3A6B49" },
  executed: { label: "Executed", bg: "#E8F5E9", color: "#2E7D32" },
  skipped:  { label: "Skipped",  bg: "#F5F5F5", color: "#9C8E7A" },
};

export default function RotationStepRow({
  step,
  index,
  camps,
  mobs,
  rotationByCampId,
  isFirstPending,
  isLastPending,
  prevStepCampId,
  farmSlug,
  onMoveUp,
  onMoveDown,
  onExecuted,
}: Props) {
  const [showExecute, setShowExecute] = useState(false);

  const camp = camps.find((c) => c.campId === step.campId);
  const mob = mobs.find((m) => m.id === step.mobId);
  const chip = STATUS_CHIP[step.status] ?? STATUS_CHIP.pending;

  const plannedStartDate = new Date(step.plannedStart).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  async function executeStep(stepId: string, mobId: string) {
    const res = await fetch(
      `/api/${farmSlug}/rotation/plans/${step.planId}/steps/${stepId}/execute`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobId }),
      },
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? "Execute failed");
    }
    const data = (await res.json()) as { step: RotationStep };
    onExecuted(data.step);
  }

  return (
    <>
      <div className="flex items-center gap-3 p-3 rounded-lg bg-white border" style={{ borderColor: "#E8E0D8" }}>
        {/* Sequence badge */}
        <div
          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
          style={{ background: "#F0F4F0", color: "#3A6B49" }}
        >
          {step.sequence}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate" style={{ color: "#1C1815" }}>
              {camp?.campName ?? step.campId}
            </span>
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: chip.bg, color: chip.color }}
            >
              {chip.label}
            </span>
          </div>
          <div className="text-xs mt-0.5 flex gap-3" style={{ color: "#9C8E7A" }}>
            <span>{mob ? mob.name : "Any mob"}</span>
            <span>{plannedStartDate}</span>
            <span>{step.plannedDays}d</span>
          </div>
          {step.actualStart && (
            <div className="text-xs mt-0.5" style={{ color: "#3A6B49" }}>
              Moved {new Date(step.actualStart).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {step.status === "pending" && (
            <>
              <button
                onClick={onMoveUp}
                disabled={isFirstPending}
                className="p-1 rounded disabled:opacity-30"
                title="Move step up"
                style={{ color: "#9C8E7A" }}
              >
                <ChevronUp size={16} />
              </button>
              <button
                onClick={onMoveDown}
                disabled={isLastPending}
                className="p-1 rounded disabled:opacity-30"
                title="Move step down"
                style={{ color: "#9C8E7A" }}
              >
                <ChevronDown size={16} />
              </button>
            </>
          )}
          {isFirstPending && step.status === "pending" && (
            <button
              onClick={() => setShowExecute(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-white ml-1"
              style={{ background: "#3A6B49" }}
              title="Execute this step now"
            >
              <Play size={12} />
              Execute
            </button>
          )}
        </div>
      </div>

      {showExecute && (
        <ExecuteStepModal
          step={step}
          camps={camps}
          mobs={mobs}
          prevStepCampId={prevStepCampId}
          onExecute={executeStep}
          onClose={() => setShowExecute(false)}
        />
      )}
    </>
  );
}
