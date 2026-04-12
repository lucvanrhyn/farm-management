import { type PrismaClient } from "@prisma/client";
import { GrazingQuality, WaterStatus, FenceStatus } from "@/lib/types";
import { calcDaysGrazingRemaining } from "@/lib/server/analytics";

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
  details: { symptoms?: string[]; severity?: string };
  observedAt: string; // ISO string
}

export async function getLatestCampConditions(prisma: PrismaClient): Promise<Map<string, LiveCampStatus>> {
  // Use distinct on campId with descending observedAt to get only the latest
  // observation per camp — avoids fetching the entire historical table.
  const observations = await prisma.observation.findMany({
    where: { type: { in: ["camp_condition", "camp_check"] } },
    orderBy: { observedAt: "desc" },
    distinct: ["campId"],
  });

  const result = new Map<string, LiveCampStatus>();
  for (const obs of observations) {
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

export async function getRecentHealthObservations(prisma: PrismaClient, limit = 8): Promise<HealthObservation[]> {
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

export async function countHealthIssuesSince(prisma: PrismaClient, since: Date): Promise<number> {
  return prisma.observation.count({
    where: { type: "health_issue", observedAt: { gte: since } },
  });
}

/**
 * Returns the number of camps with <7 days of grazing remaining (LSU-based).
 * Uses 3 batched queries — safe to call on the admin home page.
 */
export async function getLowGrazingCampCount(prisma: PrismaClient, warningDays = 7): Promise<number> {
  const [camps, allCoverReadings, allAnimals] = await Promise.all([
    prisma.camp.findMany({ select: { campId: true, sizeHectares: true } }),
    prisma.campCoverReading.findMany({ orderBy: { recordedAt: "desc" } }),
    prisma.animal.groupBy({
      by: ["currentCamp", "species", "category"],
      where: { status: "Active" },
      _count: { id: true },
    }),
  ]);

  const latestCover = new Map<string, { kgDmPerHa: number; useFactor: number }>();
  for (const r of allCoverReadings) {
    if (!latestCover.has(r.campId)) {
      latestCover.set(r.campId, { kgDmPerHa: r.kgDmPerHa, useFactor: r.useFactor });
    }
  }

  const animalsByCamp = new Map<string, Array<{ category: string; count: number }>>();
  for (const r of allAnimals) {
    const campId = r.currentCamp ?? "";
    if (!animalsByCamp.has(campId)) animalsByCamp.set(campId, []);
    animalsByCamp.get(campId)!.push({ category: r.category, count: r._count.id });
  }

  let count = 0;
  for (const camp of camps) {
    if (!camp.sizeHectares) continue;
    const cover = latestCover.get(camp.campId);
    if (!cover) continue;
    const days = calcDaysGrazingRemaining(
      cover.kgDmPerHa,
      cover.useFactor,
      camp.sizeHectares,
      animalsByCamp.get(camp.campId) ?? []
    );
    if (days !== null && days < warningDays) count++;
  }
  return count;
}

export async function countInspectedToday(prisma: PrismaClient): Promise<number> {
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
