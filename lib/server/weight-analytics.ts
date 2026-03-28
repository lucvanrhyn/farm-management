// lib/server/weight-analytics.ts
import type { PrismaClient } from "@prisma/client";

export interface WeightRecord {
  id: string;
  observedAt: Date;
  weightKg: number;
  notes?: string;
}

export interface ADGResult {
  latestWeight: number | null;
  adg: number | null;          // kg/day, null if <2 readings
  adgTrend: "good" | "ok" | "poor" | null;
  records: WeightRecord[];
}

function parseWeightDetails(raw: string): { weight_kg?: number; notes?: string } {
  try {
    return JSON.parse(raw) as { weight_kg?: number; notes?: string };
  } catch {
    return {};
  }
}

function calcAdgTrend(adg: number): "good" | "ok" | "poor" {
  if (adg > 0.9) return "good";
  if (adg >= 0.7) return "ok";
  return "poor";
}

export async function getAnimalWeightData(
  prisma: PrismaClient,
  animalId: string,
): Promise<ADGResult> {
  const rawObs = await prisma.observation.findMany({
    where: { type: "weighing", animalId },
    orderBy: { observedAt: "asc" },
  });

  const records: WeightRecord[] = rawObs.flatMap((obs) => {
    const details = parseWeightDetails(obs.details);
    if (typeof details.weight_kg !== "number") return [];
    return [
      {
        id: obs.id,
        observedAt: obs.observedAt,
        weightKg: details.weight_kg,
        notes: details.notes,
      },
    ];
  });

  if (records.length === 0) {
    return { latestWeight: null, adg: null, adgTrend: null, records: [] };
  }

  const latestWeight = records[records.length - 1].weightKg;

  if (records.length < 2) {
    return { latestWeight, adg: null, adgTrend: null, records };
  }

  const prev = records[records.length - 2];
  const last = records[records.length - 1];
  const daysDiff =
    (last.observedAt.getTime() - prev.observedAt.getTime()) / (1000 * 60 * 60 * 24);

  if (daysDiff <= 0) {
    return { latestWeight, adg: null, adgTrend: null, records };
  }

  const adg = (last.weightKg - prev.weightKg) / daysDiff;
  const adgTrend = calcAdgTrend(adg);

  return { latestWeight, adg, adgTrend, records };
}
