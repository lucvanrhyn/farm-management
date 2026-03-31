import type { PrismaClient } from "@prisma/client";

export interface DataHealthScore {
  overall: number;
  grade: "A" | "B" | "C" | "D";
  breakdown: {
    animalsWeighedRecently: { score: number; pct: number; label: string };
    campsInspectedRecently: { score: number; pct: number; label: string };
    animalsWithCampAssigned: { score: number; pct: number; label: string };
    transactionsThisMonth: { score: number; present: boolean; label: string };
  };
}

export async function getDataHealthScore(
  prisma: PrismaClient
): Promise<DataHealthScore> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const currentMonth = now.toISOString().slice(0, 7); // "YYYY-MM"

  const [
    activeCount,
    totalCamps,
    weighedGroups,
    inspectedGroups,
    assignedCount,
    txThisMonth,
  ] = await Promise.all([
    prisma.animal.count({ where: { status: "Active" } }),
    prisma.camp.count(),
    prisma.observation.groupBy({
      by: ["animalId"],
      where: {
        type: "weighing",
        observedAt: { gte: thirtyDaysAgo },
        animalId: { not: null },
      },
    }),
    prisma.observation.groupBy({
      by: ["campId"],
      where: {
        type: "camp_condition",
        observedAt: { gte: sevenDaysAgo },
        campId: { not: "" },
      },
    }),
    prisma.animal.count({
      where: { status: "Active", currentCamp: { not: "" } },
    }),
    prisma.transaction.count({
      where: { date: { startsWith: currentMonth } },
    }),
  ]);

  const weighedCount = weighedGroups.length;
  const inspectedCount = inspectedGroups.length;

  const weighedPct =
    activeCount > 0 ? Math.min(1, weighedCount / activeCount) : 0;
  const inspectedPct =
    totalCamps > 0 ? Math.min(1, inspectedCount / totalCamps) : 0;
  const assignedPct = activeCount > 0 ? Math.min(1, assignedCount / activeCount) : 0;
  const hasTxThisMonth = txThisMonth > 0;

  const weighedScore = Math.round(weighedPct * 40);
  const inspectedScore = Math.round(inspectedPct * 30);
  const assignedScore = Math.round(assignedPct * 20);
  const txScore = hasTxThisMonth ? 10 : 0;

  const overall = weighedScore + inspectedScore + assignedScore + txScore;
  const grade: "A" | "B" | "C" | "D" =
    overall >= 80 ? "A" : overall >= 60 ? "B" : overall >= 40 ? "C" : "D";

  return {
    overall,
    grade,
    breakdown: {
      animalsWeighedRecently: {
        score: weighedScore,
        pct: Math.round(weighedPct * 100),
        label: `${weighedCount} of ${activeCount} animals weighed in last 30 days`,
      },
      campsInspectedRecently: {
        score: inspectedScore,
        pct: Math.round(inspectedPct * 100),
        label: `${inspectedCount} of ${totalCamps} camps inspected in last 7 days`,
      },
      animalsWithCampAssigned: {
        score: assignedScore,
        pct: Math.round(assignedPct * 100),
        label: `${assignedCount} of ${activeCount} active animals have a camp`,
      },
      transactionsThisMonth: {
        score: txScore,
        present: hasTxThisMonth,
        label: hasTxThisMonth
          ? "Transactions recorded this month"
          : "No transactions recorded this month",
      },
    },
  };
}
