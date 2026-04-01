import type { PrismaClient, Prisma } from "@prisma/client";

export interface FinancialAnalyticsResult {
  grossMargin: number;
  grossMarginPerHead: number | null;
  costOfGain: number | null;
  totalIncome: number;
  totalExpenses: number;
  expensesByCategory: { category: string; amount: number }[];
}

export interface CampCostRow {
  campId: string;
  campName: string;
  totalCost: number;
  hectares: number | null;
  costPerHa: number | null;
}

export interface AnimalInvestmentResult {
  animalId: string;
  totalCost: number;
  breakdown: Array<{ category: string; amount: number }>;
}

export interface CategoryProfitabilityRow {
  category: string;
  income: number;
  expense: number;
  margin: number;
  headCount: number;
  marginPerHead: number;
}

export interface FinancialKPIs {
  grossMarginPercent: number;
  revenuePerHead: number;
  opexRatio: number;
  totalIncome: number;
  totalExpense: number;
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

// ── New Phase 5 analytics functions ──────────────────────────────────────────

export async function getCostPerCamp(
  prisma: PrismaClient,
  farmSlug: string,
  dateRange?: { from: string; to: string },
): Promise<CampCostRow[]> {
  void farmSlug; // farmSlug is used for multi-tenant routing upstream; prisma is already scoped

  const where: Prisma.TransactionWhereInput = {
    type: "expense",
    campId: { not: null },
    ...(dateRange ? { date: { gte: dateRange.from, lte: dateRange.to } } : {}),
  };

  const [transactions, camps] = await Promise.all([
    prisma.transaction.findMany({
      where,
      select: { campId: true, amount: true },
    }),
    prisma.camp.findMany({ select: { campId: true, campName: true, sizeHectares: true } }),
  ]);

  const campMap = new Map(camps.map((c) => [c.campId, c]));
  const costByCamp = new Map<string, number>();

  for (const tx of transactions) {
    if (!tx.campId) continue;
    costByCamp.set(tx.campId, (costByCamp.get(tx.campId) ?? 0) + tx.amount);
  }

  return Array.from(costByCamp.entries())
    .map(([campId, totalCost]) => {
      const camp = campMap.get(campId);
      const hectares = camp?.sizeHectares ?? null;
      const costPerHa = hectares && hectares > 0 ? totalCost / hectares : null;
      return {
        campId,
        campName: camp?.campName ?? campId,
        totalCost,
        hectares,
        costPerHa,
      };
    })
    .sort((a, b) => b.totalCost - a.totalCost);
}

export async function getCostPerAnimal(
  prisma: PrismaClient,
  animalId: string,
): Promise<AnimalInvestmentResult> {
  const transactions = await prisma.transaction.findMany({
    where: { animalId },
    select: { amount: true, category: true },
  });

  let totalCost = 0;
  const categoryMap = new Map<string, number>();

  for (const tx of transactions) {
    totalCost += tx.amount;
    categoryMap.set(tx.category, (categoryMap.get(tx.category) ?? 0) + tx.amount);
  }

  const breakdown = Array.from(categoryMap.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  return { animalId, totalCost, breakdown };
}

export async function getProfitabilityByCategory(
  prisma: PrismaClient,
  farmSlug: string,
  dateRange?: { from: string; to: string },
): Promise<CategoryProfitabilityRow[]> {
  void farmSlug;

  const txWhere: Prisma.TransactionWhereInput = {
    animalId: { not: null },
    ...(dateRange ? { date: { gte: dateRange.from, lte: dateRange.to } } : {}),
  };

  const [transactions, animals] = await Promise.all([
    prisma.transaction.findMany({
      where: txWhere,
      select: { type: true, amount: true, animalId: true },
    }),
    prisma.animal.findMany({
      where: { status: "Active" },
      select: { animalId: true, category: true },
    }),
  ]);

  const animalCategoryMap = new Map(animals.map((a) => [a.animalId, a.category]));

  // Count active animals per category
  const headCountMap = new Map<string, number>();
  for (const animal of animals) {
    headCountMap.set(animal.category, (headCountMap.get(animal.category) ?? 0) + 1);
  }

  const incomeMap = new Map<string, number>();
  const expenseMap = new Map<string, number>();

  for (const tx of transactions) {
    if (!tx.animalId) continue;
    const category = animalCategoryMap.get(tx.animalId);
    if (!category) continue;
    if (tx.type === "income") {
      incomeMap.set(category, (incomeMap.get(category) ?? 0) + tx.amount);
    } else {
      expenseMap.set(category, (expenseMap.get(category) ?? 0) + tx.amount);
    }
  }

  const allCategories = new Set([...incomeMap.keys(), ...expenseMap.keys()]);

  return Array.from(allCategories)
    .map((category) => {
      const income = incomeMap.get(category) ?? 0;
      const expense = expenseMap.get(category) ?? 0;
      const margin = income - expense;
      const headCount = headCountMap.get(category) ?? 0;
      const marginPerHead = headCount > 0 ? margin / headCount : 0;
      return { category, income, expense, margin, headCount, marginPerHead };
    })
    .sort((a, b) => b.margin - a.margin);
}

export async function getFinancialKPIs(
  prisma: PrismaClient,
  farmSlug: string,
  dateRange?: { from: string; to: string },
): Promise<FinancialKPIs> {
  void farmSlug;

  const txWhere: Prisma.TransactionWhereInput = dateRange
    ? { date: { gte: dateRange.from, lte: dateRange.to } }
    : {};

  const [transactions, totalAnimals] = await Promise.all([
    prisma.transaction.findMany({
      where: txWhere,
      select: { type: true, amount: true },
    }),
    prisma.animal.count({ where: { status: "Active" } }),
  ]);

  let totalIncome = 0;
  let totalExpense = 0;

  for (const tx of transactions) {
    if (tx.type === "income") {
      totalIncome += tx.amount;
    } else {
      totalExpense += tx.amount;
    }
  }

  const grossMarginPercent = totalIncome > 0
    ? ((totalIncome - totalExpense) / totalIncome) * 100
    : 0;
  const revenuePerHead = totalAnimals > 0 ? totalIncome / totalAnimals : 0;
  const opexRatio = totalIncome > 0 ? (totalExpense / totalIncome) * 100 : 0;

  return { grossMarginPercent, revenuePerHead, opexRatio, totalIncome, totalExpense };
}
