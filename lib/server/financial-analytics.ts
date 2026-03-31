import type { PrismaClient } from "@prisma/client";

export interface FinancialAnalyticsResult {
  grossMargin: number;
  grossMarginPerHead: number | null;
  costOfGain: number | null;
  totalIncome: number;
  totalExpenses: number;
  expensesByCategory: { category: string; amount: number }[];
}

function parseWeightDetails(raw: string): { weight_kg?: number } {
  try { return JSON.parse(raw) as { weight_kg?: number }; }
  catch { return {}; }
}

export async function getFinancialAnalytics(
  prisma: PrismaClient,
  from: Date,
  to: Date,
): Promise<FinancialAnalyticsResult> {
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  const [transactions, activeCount, weighingsRaw] = await Promise.all([
    prisma.transaction.findMany({
      where: { date: { gte: fromStr, lte: toStr } },
      select: { type: true, amount: true, category: true },
    }),
    prisma.animal.count({ where: { status: "Active" } }),
    prisma.observation.findMany({
      where: {
        type: "weighing",
        observedAt: { lte: to },
        animalId: { not: null },
      },
      select: { animalId: true, observedAt: true, details: true },
      orderBy: { observedAt: "asc" },
    }),
  ]);

  let totalIncome = 0;
  let totalExpenses = 0;
  const expenseMap = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.type === "income") {
      totalIncome += tx.amount;
    } else {
      totalExpenses += tx.amount;
      expenseMap.set(tx.category, (expenseMap.get(tx.category) ?? 0) + tx.amount);
    }
  }
  const grossMargin = totalIncome - totalExpenses;
  const grossMarginPerHead = activeCount > 0 ? grossMargin / activeCount : null;

  const expensesByCategory = [...expenseMap.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  const byAnimal = new Map<string, { date: Date; weightKg: number }[]>();
  for (const obs of weighingsRaw) {
    if (!obs.animalId) continue;
    const d = parseWeightDetails(obs.details);
    if (typeof d.weight_kg !== "number") continue;
    byAnimal.set(obs.animalId, [
      ...(byAnimal.get(obs.animalId) ?? []),
      { date: obs.observedAt, weightKg: d.weight_kg },
    ]);
  }

  let totalKgGained = 0;
  for (const records of byAnimal.values()) {
    const baseline = [...records].reverse().find((r) => r.date < from);
    const inRange = records.filter((r) => r.date >= from && r.date <= to);
    const latest = inRange[inRange.length - 1];
    if (baseline && latest && latest.weightKg > baseline.weightKg) {
      totalKgGained += latest.weightKg - baseline.weightKg;
    }
  }
  const costOfGain = totalKgGained > 0 ? totalExpenses / totalKgGained : null;

  return {
    grossMargin,
    grossMarginPerHead,
    costOfGain,
    totalIncome,
    totalExpenses,
    expensesByCategory,
  };
}
