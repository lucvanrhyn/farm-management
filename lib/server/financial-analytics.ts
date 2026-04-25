import type { PrismaClient, Prisma } from "@prisma/client";
import {
  calcCostOfGain,
  categoriesForScope,
  type CogScope,
} from "@/lib/calculators/cost-of-gain";

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

export interface BudgetVsActualRow {
  categoryName: string;
  type: "income" | "expense";
  budgeted: number;
  actual: number;
  variance: number;
  variancePercent: number | null;
  months: number;
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
    // cross-species by design: financial KPI denominator is farm-wide head count.
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
  // Filter to expense-only — income transactions (e.g. animal sale) are not costs
  const transactions = await prisma.transaction.findMany({
    where: { animalId, type: "expense" },
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
    // cross-species by design: profitability-by-category aggregates all species.
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
    // cross-species by design: financial KPI denominator is farm-wide head count.
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

export async function getBudgetVsActual(
  prisma: PrismaClient,
  from: Date,
  to: Date,
): Promise<BudgetVsActualRow[]> {
  const fromYear = from.getUTCFullYear();
  const fromMonth = from.getUTCMonth() + 1;
  const toYear = to.getUTCFullYear();
  const toMonth = to.getUTCMonth() + 1;
  const fromKey = fromYear * 12 + (fromMonth - 1);
  const toKey = toYear * 12 + (toMonth - 1);
  const monthsInPeriod = Math.max(1, toKey - fromKey + 1);

  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  const [budgetsRaw, transactions] = await Promise.all([
    prisma.budget.findMany({
      select: { year: true, month: true, categoryName: true, type: true, amount: true },
    }),
    prisma.transaction.findMany({
      where: { date: { gte: fromStr, lte: toStr } },
      select: { type: true, category: true, amount: true },
    }),
  ]);

  const budgets = budgetsRaw.filter((b) => {
    const key = b.year * 12 + (b.month - 1);
    return key >= fromKey && key <= toKey;
  });

  type Agg = { type: "income" | "expense"; budgeted: number; actual: number; months: Set<number> };
  const byCategory = new Map<string, Agg>();

  const touch = (name: string, type: "income" | "expense"): Agg => {
    let agg = byCategory.get(name);
    if (!agg) {
      agg = { type, budgeted: 0, actual: 0, months: new Set<number>() };
      byCategory.set(name, agg);
    }
    return agg;
  };

  for (const b of budgets) {
    const type = b.type === "income" ? "income" : "expense";
    const agg = touch(b.categoryName, type);
    agg.type = type;
    agg.budgeted += b.amount;
    agg.months.add(b.year * 12 + (b.month - 1));
  }

  for (const tx of transactions) {
    const type = tx.type === "income" ? "income" : "expense";
    const agg = touch(tx.category, type);
    agg.actual += tx.amount;
  }

  const rows: BudgetVsActualRow[] = [];
  for (const [categoryName, agg] of byCategory.entries()) {
    if (agg.budgeted === 0 && agg.actual === 0) continue;
    const variance = agg.actual - agg.budgeted;
    const variancePercent = agg.budgeted > 0 ? (variance / agg.budgeted) * 100 : null;
    rows.push({
      categoryName,
      type: agg.type,
      budgeted: agg.budgeted,
      actual: agg.actual,
      variance,
      variancePercent,
      months: agg.months.size > 0 ? agg.months.size : monthsInPeriod,
    });
  }

  rows.sort((a, b) => {
    if (a.type !== b.type) return a.type === "expense" ? -1 : 1;
    if (a.type === "expense") return b.variance - a.variance;
    return a.variance - b.variance;
  });

  return rows;
}

// ── Cost of Gain (A7) ────────────────────────────────────────────────────────

export interface CogByCampRow {
  campId: string;
  campName: string;
  hectares: number | null;
  activeAnimalCount: number;
  totalCost: number;
  kgGained: number;
  costOfGain: number | null;
}

export interface CogByAnimalRow {
  animalId: string;
  name: string | null;
  category: string;
  currentCamp: string;
  totalCost: number;
  kgGained: number;
  costOfGain: number | null;
}

export interface CogSummary {
  totalCost: number;
  kgGained: number;
  costOfGain: number | null;
  activeAnimals: number;
}

/**
 * Computes per-animal kg gained within [from, to].
 * Baseline = latest weighing strictly before `from`; end = latest weighing in [from, to].
 * Mirrors the loop at lines 101–120 of this file so the headline farm-wide COG reconciles.
 */
async function computeKgGainedByAnimal(
  prisma: PrismaClient,
  from: Date,
  to: Date,
): Promise<Map<string, number>> {
  const weighings = await prisma.observation.findMany({
    where: {
      type: "weighing",
      observedAt: { lte: to },
      animalId: { not: null },
    },
    select: { animalId: true, observedAt: true, details: true },
    orderBy: { observedAt: "asc" },
  });

  const byAnimal = new Map<string, { date: Date; weightKg: number }[]>();
  for (const obs of weighings) {
    if (!obs.animalId) continue;
    const d = parseWeightDetails(obs.details);
    if (typeof d.weight_kg !== "number") continue;
    const list = byAnimal.get(obs.animalId) ?? [];
    list.push({ date: obs.observedAt, weightKg: d.weight_kg });
    byAnimal.set(obs.animalId, list);
  }

  const gains = new Map<string, number>();
  for (const [animalId, records] of byAnimal.entries()) {
    const baseline = [...records].reverse().find((r) => r.date < from);
    const inRange = records.filter((r) => r.date >= from && r.date <= to);
    const latest = inRange[inRange.length - 1];
    if (baseline && latest && latest.weightKg > baseline.weightKg) {
      gains.set(animalId, latest.weightKg - baseline.weightKg);
    }
  }
  return gains;
}

function buildExpenseWhere(
  from: Date,
  to: Date,
  scope: CogScope,
): Prisma.TransactionWhereInput {
  const categories = categoriesForScope(scope);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);
  return {
    type: "expense",
    date: { gte: fromStr, lte: toStr },
    ...(categories ? { category: { in: [...categories] } } : {}),
  };
}

export async function getCogByCamp(
  prisma: PrismaClient,
  from: Date,
  to: Date,
  scope: CogScope,
): Promise<CogByCampRow[]> {
  const [transactions, camps, animals, kgByAnimal] = await Promise.all([
    prisma.transaction.findMany({
      where: { ...buildExpenseWhere(from, to, scope), campId: { not: null } },
      select: { campId: true, amount: true },
    }),
    prisma.camp.findMany({
      select: { campId: true, campName: true, sizeHectares: true },
    }),
    // cross-species by design: COG-by-camp totals every animal in a camp.
    prisma.animal.findMany({
      where: { status: "Active" },
      select: { animalId: true, currentCamp: true },
    }),
    computeKgGainedByAnimal(prisma, from, to),
  ]);

  const costByCamp = new Map<string, number>();
  for (const tx of transactions) {
    if (!tx.campId) continue;
    costByCamp.set(tx.campId, (costByCamp.get(tx.campId) ?? 0) + tx.amount);
  }

  const gainByCamp = new Map<string, number>();
  const countByCamp = new Map<string, number>();
  for (const a of animals) {
    countByCamp.set(a.currentCamp, (countByCamp.get(a.currentCamp) ?? 0) + 1);
    const gain = kgByAnimal.get(a.animalId);
    if (gain) {
      gainByCamp.set(a.currentCamp, (gainByCamp.get(a.currentCamp) ?? 0) + gain);
    }
  }

  const campIds = new Set<string>([
    ...costByCamp.keys(),
    ...gainByCamp.keys(),
  ]);

  const rows: CogByCampRow[] = [];
  for (const camp of camps) {
    if (!campIds.has(camp.campId)) continue;
    const totalCost = costByCamp.get(camp.campId) ?? 0;
    const kgGained = gainByCamp.get(camp.campId) ?? 0;
    const { costOfGain } = calcCostOfGain({ totalCost, kgGained });
    rows.push({
      campId: camp.campId,
      campName: camp.campName,
      hectares: camp.sizeHectares ?? null,
      activeAnimalCount: countByCamp.get(camp.campId) ?? 0,
      totalCost,
      kgGained,
      costOfGain,
    });
  }

  // Best (lowest) COG first; nulls last.
  rows.sort((a, b) => {
    if (a.costOfGain === null && b.costOfGain === null) return 0;
    if (a.costOfGain === null) return 1;
    if (b.costOfGain === null) return -1;
    return a.costOfGain - b.costOfGain;
  });
  return rows;
}

export async function getCogByAnimal(
  prisma: PrismaClient,
  from: Date,
  to: Date,
  scope: CogScope,
  limit = 50,
): Promise<CogByAnimalRow[]> {
  const [transactions, animals, kgByAnimal] = await Promise.all([
    prisma.transaction.findMany({
      where: { ...buildExpenseWhere(from, to, scope), animalId: { not: null } },
      select: { animalId: true, amount: true },
    }),
    // cross-species by design: COG-by-animal lookup needs every species.
    prisma.animal.findMany({
      select: {
        animalId: true,
        name: true,
        category: true,
        currentCamp: true,
      },
    }),
    computeKgGainedByAnimal(prisma, from, to),
  ]);

  const costByAnimal = new Map<string, number>();
  for (const tx of transactions) {
    if (!tx.animalId) continue;
    costByAnimal.set(
      tx.animalId,
      (costByAnimal.get(tx.animalId) ?? 0) + tx.amount,
    );
  }

  const animalIds = new Set<string>([
    ...costByAnimal.keys(),
    ...kgByAnimal.keys(),
  ]);
  const animalMap = new Map(animals.map((a) => [a.animalId, a]));

  const rows: CogByAnimalRow[] = [];
  for (const animalId of animalIds) {
    const meta = animalMap.get(animalId);
    if (!meta) continue;
    const totalCost = costByAnimal.get(animalId) ?? 0;
    const kgGained = kgByAnimal.get(animalId) ?? 0;
    const { costOfGain } = calcCostOfGain({ totalCost, kgGained });
    rows.push({
      animalId,
      name: meta.name ?? null,
      category: meta.category,
      currentCamp: meta.currentCamp,
      totalCost,
      kgGained,
      costOfGain,
    });
  }

  // Highest cost first — biggest decision value.
  rows.sort((a, b) => b.totalCost - a.totalCost);
  return rows.slice(0, limit);
}

export async function getCogSummary(
  prisma: PrismaClient,
  from: Date,
  to: Date,
  scope: CogScope,
): Promise<CogSummary> {
  const [transactions, activeAnimals, kgByAnimal] = await Promise.all([
    prisma.transaction.findMany({
      where: buildExpenseWhere(from, to, scope),
      select: { amount: true },
    }),
    // cross-species by design: financial KPI denominator is farm-wide head count.
    prisma.animal.count({ where: { status: "Active" } }),
    computeKgGainedByAnimal(prisma, from, to),
  ]);

  const totalCost = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  let kgGained = 0;
  for (const g of kgByAnimal.values()) kgGained += g;
  const { costOfGain } = calcCostOfGain({ totalCost, kgGained });

  return { totalCost, kgGained, costOfGain, activeAnimals };
}
