import { prisma } from "@/lib/prisma";
import { GrazingQuality, WaterStatus, FenceStatus } from "@/lib/types";

export interface LiveCampStatus {
  grazing_quality: GrazingQuality;
  water_status: WaterStatus;
  fence_status: FenceStatus;
  last_inspected_at: string; // ISO string
  last_inspected_by: string | null;
}

export interface HealthObservation {
  id: string;
  animalId: string | null;
  campId: string;
  details: { symptoms?: string[]; severity?: string; notes?: string };
  observedAt: string; // ISO string
}

export async function getLatestCampConditions(): Promise<Map<string, LiveCampStatus>> {
  const observations = await prisma.observation.findMany({
    where: { type: { in: ["camp_condition", "camp_check"] } },
    orderBy: { observedAt: "desc" },
  });

  const result = new Map<string, LiveCampStatus>();
  for (const obs of observations) {
    if (result.has(obs.campId)) continue;
    let details: Record<string, string> = {};
    try {
      details = JSON.parse(obs.details);
    } catch {
      // malformed details — skip
    }
    const inspectedAt = obs.observedAt instanceof Date ? obs.observedAt.toISOString() : obs.observedAt;
    if (obs.type === "camp_condition") {
      result.set(obs.campId, {
        grazing_quality: (details.grazing as GrazingQuality) ?? "Fair",
        water_status: (details.water as WaterStatus) ?? "Full",
        fence_status: (details.fence as FenceStatus) ?? "Intact",
        last_inspected_at: inspectedAt,
        last_inspected_by: details.logged_by ?? null,
      });
    } else {
      // camp_check — all-normal, no specific condition data
      result.set(obs.campId, {
        grazing_quality: "Good",
        water_status: "Full",
        fence_status: "Intact",
        last_inspected_at: inspectedAt,
        last_inspected_by: details.logged_by ?? null,
      });
    }
  }
  return result;
}

export async function getRecentHealthObservations(limit = 8): Promise<HealthObservation[]> {
  const rows = await prisma.observation.findMany({
    where: { type: "health_issue" },
    orderBy: { observedAt: "desc" },
    take: limit,
  });

  return rows.map((obs) => {
    let details: HealthObservation["details"] = {};
    try {
      details = JSON.parse(obs.details);
    } catch {
      // malformed details
    }
    return {
      id: obs.id,
      animalId: obs.animalId,
      campId: obs.campId,
      details,
      observedAt: obs.observedAt instanceof Date ? obs.observedAt.toISOString() : obs.observedAt,
    };
  });
}

export async function countHealthIssuesSince(since: Date): Promise<number> {
  return prisma.observation.count({
    where: { type: "health_issue", observedAt: { gte: since } },
  });
}

export async function countInspectedToday(): Promise<number> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const rows = await prisma.observation.findMany({
    where: {
      type: { in: ["camp_condition", "camp_check"] },
      observedAt: { gte: todayStart },
    },
    select: { campId: true },
  });

  return new Set(rows.map((r) => r.campId)).size;
}
