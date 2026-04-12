export interface PlanCamp {
  id: string;
  campId: string;
  campName: string;
  sizeHectares: number | null;
}

export interface PlanMob {
  id: string;
  name: string;
  currentCamp: string;
}

export interface RotationStep {
  id: string;
  planId: string;
  sequence: number;
  campId: string;
  mobId: string | null;
  plannedStart: string; // ISO
  plannedDays: number;
  status: "pending" | "executed" | "skipped";
  actualStart: string | null;
  actualEnd: string | null;
  executedObservationId: string | null;
  notes: string | null;
}

export interface RotationPlan {
  id: string;
  name: string;
  startDate: string; // ISO
  status: "draft" | "active" | "completed" | "archived";
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  steps: RotationStep[];
}

export interface CampRotationInfo {
  status: string;
  effectiveMaxGrazingDays: number;
  effectiveRestDays: number;
}
