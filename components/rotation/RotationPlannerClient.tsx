"use client";

import { useState } from "react";
import type { RotationPlan, PlanCamp, PlanMob, CampRotationInfo } from "./types";
import RotationPlanList from "./RotationPlanList";
import RotationPlanBuilder from "./RotationPlanBuilder";

interface Props {
  farmSlug: string;
  plans: RotationPlan[];
  rotationByCampId: Record<string, CampRotationInfo>;
  camps: PlanCamp[];
  mobs: PlanMob[];
}

export default function RotationPlannerClient({
  farmSlug,
  plans: initialPlans,
  rotationByCampId,
  camps,
  mobs,
}: Props) {
  const [plans, setPlans] = useState<RotationPlan[]>(initialPlans);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(
    initialPlans.find((p) => p.status === "active")?.id ?? initialPlans[0]?.id ?? null,
  );

  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;

  function handlePlanCreated(plan: RotationPlan) {
    setPlans((prev) => [plan, ...prev]);
    setSelectedPlanId(plan.id);
  }

  function handlePlanUpdated(updated: RotationPlan) {
    setPlans((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setSelectedPlanId(updated.id);
  }

  function handlePlanDeleted(planId: string) {
    const remaining = plans.filter((p) => p.id !== planId);
    setPlans(remaining);
    setSelectedPlanId(remaining[0]?.id ?? null);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 items-start">
      {/* Left: plan list */}
      <div
        className="rounded-xl border p-4"
        style={{ borderColor: "#E8E0D8", background: "#FFFFFF" }}
      >
        <RotationPlanList
          plans={plans}
          selectedPlanId={selectedPlanId}
          farmSlug={farmSlug}
          onSelect={(p) => setSelectedPlanId(p.id)}
          onCreated={handlePlanCreated}
        />
      </div>

      {/* Right: builder */}
      <div
        className="rounded-xl border p-4 min-h-[300px]"
        style={{ borderColor: "#E8E0D8", background: "#FFFFFF" }}
      >
        {selectedPlan ? (
          <RotationPlanBuilder
            plan={selectedPlan}
            camps={camps}
            mobs={mobs}
            rotationByCampId={rotationByCampId}
            farmSlug={farmSlug}
            onPlanUpdated={handlePlanUpdated}
            onPlanDeleted={handlePlanDeleted}
          />
        ) : (
          <div className="flex items-center justify-center h-full py-16">
            <p className="text-sm" style={{ color: "#9C8E7A" }}>
              Select or create a plan to get started.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
