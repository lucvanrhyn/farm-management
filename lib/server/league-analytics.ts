import type { PrismaClient } from "@prisma/client";
import { calcDaysGrazingRemaining } from "./analytics";

export interface CampLeagueRow {
  campId: string;
  campName: string;
  sizeHectares: number | null;
  headcount: number;
  avgAdg: number | null;
  lsuPerHa: number | null;
  condition: "Good" | "Fair" | "Poor" | null;
  daysGrazingRemaining: number | null;
  lastInspection: string | null;
}

const LSU_FACTOR: Record<string, number> = {
  Cow: 1.0, Bull: 1.2, Heifer: 0.7, Calf: 0.3, Ox: 1.1,
};

function parseDetails(raw: string): Record<string, string> {
  try { return JSON.parse(raw) as Record<string, string>; }
  catch { return {}; }
}

function parseWeightDetails(raw: string): { weight_kg?: number } {
  try { return JSON.parse(raw) as { weight_kg?: number }; }
  catch { return {}; }
}

export async function getCampLeagueData(prisma: PrismaClient): Promise<CampLeagueRow[]> {
  const camps = await prisma.camp.findMany({ orderBy: { campId: "asc" } });

  const rows = await Promise.all(
    camps.map(async (camp) => {
      const [activeAnimals, latestCondition, latestCover] = await Promise.all([
        prisma.animal.findMany({
          where: { currentCamp: camp.campId, status: "Active" },
          select: { id: true, category: true },
        }),
        prisma.observation.findFirst({
          where: { campId: camp.campId, type: "camp_condition" },
          orderBy: { observedAt: "desc" },
        }),
        prisma.campCoverReading.findFirst({
          where: { campId: camp.campId },
          orderBy: { recordedAt: "desc" },
        }),
      ]);

      const headcount = activeAnimals.length;

      const categoryCount = new Map<string, number>();
      for (const a of activeAnimals) {
        categoryCount.set(a.category, (categoryCount.get(a.category) ?? 0) + 1);
      }
      const totalLSU = [...categoryCount.entries()].reduce(
        (s, [cat, cnt]) => s + cnt * (LSU_FACTOR[cat] ?? 1.0),
        0,
      );
      const lsuPerHa =
        camp.sizeHectares && camp.sizeHectares > 0
          ? Math.round((totalLSU / camp.sizeHectares) * 100) / 100
          : null;

      const weighings =
        activeAnimals.length > 0
          ? await prisma.observation.findMany({
              where: {
                type: "weighing",
                animalId: { in: activeAnimals.map((a) => a.id) },
              },
              select: { animalId: true, observedAt: true, details: true },
              orderBy: { observedAt: "asc" },
            })
          : [];

      const byAnimal = new Map<string, { date: Date; weightKg: number }[]>();
      for (const obs of weighings) {
        if (!obs.animalId) continue;
        const d = parseWeightDetails(obs.details);
        if (typeof d.weight_kg !== "number") continue;
        byAnimal.set(obs.animalId, [
          ...(byAnimal.get(obs.animalId) ?? []),
          { date: obs.observedAt, weightKg: d.weight_kg },
        ]);
      }

      const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
      const adgs: number[] = [];
      for (const records of byAnimal.values()) {
        if (records.length < 2) continue;
        const last = records[records.length - 1];
        const first = records[0];

        let bestAdg: number | null = null;

        const window90 = records.filter((r) => r.date >= ninetyDaysAgo);
        if (window90.length >= 2) {
          const days = (last.date.getTime() - window90[0].date.getTime()) / 86_400_000;
          if (days > 0) bestAdg = (last.weightKg - window90[0].weightKg) / days;
        } else if (window90.length === 1) {
          const baseIdx =
            records.findIndex((r) => r.date.getTime() === window90[0].date.getTime()) - 1;
          if (baseIdx >= 0) {
            const baseline = records[baseIdx];
            const days = (last.date.getTime() - baseline.date.getTime()) / 86_400_000;
            if (days > 0) bestAdg = (last.weightKg - baseline.weightKg) / days;
          }
        }

        if (bestAdg === null) {
          const days = (last.date.getTime() - first.date.getTime()) / 86_400_000;
          if (days > 0) bestAdg = (last.weightKg - first.weightKg) / days;
        }

        if (bestAdg !== null) adgs.push(bestAdg);
      }

      const avgAdg =
        adgs.length > 0
          ? Math.round((adgs.reduce((s, v) => s + v, 0) / adgs.length) * 100) / 100
          : null;

      let condition: "Good" | "Fair" | "Poor" | null = null;
      if (latestCondition?.details) {
        const details = parseDetails(latestCondition.details);
        const g = details.grazing;
        if (g === "Good" || g === "Fair" || g === "Poor") condition = g;
      }

      const animalsByCategory = [...categoryCount.entries()].map(([category, count]) => ({
        category,
        count,
      }));
      const rawDays =
        latestCover && camp.sizeHectares && camp.sizeHectares > 0
          ? calcDaysGrazingRemaining(
              latestCover.kgDmPerHa,
              latestCover.useFactor,
              camp.sizeHectares,
              animalsByCategory,
            )
          : null;
      const daysGrazingRemaining = rawDays !== null ? Math.round(rawDays) : null;

      const lastInspection = latestCondition?.observedAt
        ? new Date(latestCondition.observedAt).toISOString().slice(0, 10)
        : null;

      return {
        campId: camp.campId,
        campName: camp.campName,
        sizeHectares: camp.sizeHectares,
        headcount,
        avgAdg,
        lsuPerHa,
        condition,
        daysGrazingRemaining,
        lastInspection,
      };
    }),
  );

  return rows;
}
