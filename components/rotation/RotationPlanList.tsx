"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { RotationPlan } from "./types";

interface Props {
  plans: RotationPlan[];
  selectedPlanId: string | null;
  farmSlug: string;
  onSelect: (plan: RotationPlan) => void;
  onCreated: (plan: RotationPlan) => void;
}

const STATUS_CHIP: Record<string, { label: string; bg: string; color: string }> = {
  draft:     { label: "Draft",     bg: "#F5F5F5", color: "#9C8E7A" },
  active:    { label: "Active",    bg: "#E8F5E9", color: "#2E7D32" },
  completed: { label: "Completed", bg: "#E3F2FD", color: "#1565C0" },
  archived:  { label: "Archived",  bg: "#FAFAFA", color: "#BDBDBD" },
};

export default function RotationPlanList({
  plans,
  selectedPlanId,
  farmSlug,
  onSelect,
  onCreated,
}: Props) {
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStartDate, setNewStartDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [creating, setCreating] = useState(false);

  const visiblePlans = plans.filter((p) => p.status !== "archived");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newStartDate) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/${farmSlug}/rotation/plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), startDate: new Date(newStartDate).toISOString() }),
      });
      if (!res.ok) throw new Error("Create failed");
      const plan = (await res.json()) as RotationPlan;
      onCreated(plan);
      setNewName("");
      setShowNew(false);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm" style={{ color: "#3D3530" }}>
          Plans
        </h3>
        <button
          onClick={() => setShowNew(!showNew)}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg font-medium text-white"
          style={{ background: "#3A6B49" }}
        >
          <Plus size={13} />
          New
        </button>
      </div>

      {showNew && (
        <form onSubmit={handleCreate} className="p-3 rounded-lg border space-y-3" style={{ borderColor: "#E8E0D8" }}>
          <input
            type="text"
            autoFocus
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="Plan name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
          />
          <input
            type="date"
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={newStartDate}
            onChange={(e) => setNewStartDate(e.target.value)}
            required
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowNew(false)}
              className="flex-1 px-3 py-1.5 rounded-lg border text-sm"
              style={{ color: "#3D3530" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="flex-1 px-3 py-1.5 rounded-lg text-sm text-white disabled:opacity-50"
              style={{ background: "#3A6B49" }}
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      )}

      {visiblePlans.length === 0 && !showNew && (
        <p className="text-sm py-4 text-center" style={{ color: "#9C8E7A" }}>
          No plans yet. Create your first rotation plan.
        </p>
      )}

      {visiblePlans.map((plan) => {
        const chip = STATUS_CHIP[plan.status] ?? STATUS_CHIP.draft;
        const pendingCount = plan.steps.filter((s) => s.status === "pending").length;
        const nextStep = plan.steps.find((s) => s.status === "pending");
        const isSelected = plan.id === selectedPlanId;

        return (
          <button
            key={plan.id}
            onClick={() => onSelect(plan)}
            className="w-full text-left p-3 rounded-lg border transition-colors"
            style={{
              borderColor: isSelected ? "#3A6B49" : "#E8E0D8",
              background: isSelected ? "#F0F4F0" : "#FFFFFF",
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-sm truncate" style={{ color: "#1C1815" }}>
                {plan.name}
              </span>
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                style={{ background: chip.bg, color: chip.color }}
              >
                {chip.label}
              </span>
            </div>
            <div className="text-xs mt-1" style={{ color: "#9C8E7A" }}>
              {plan.steps.length} step{plan.steps.length !== 1 ? "s" : ""}
              {pendingCount > 0 && ` · ${pendingCount} pending`}
              {nextStep && ` · next: ${new Date(nextStep.plannedStart).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}`}
            </div>
          </button>
        );
      })}
    </div>
  );
}
