import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { authOptions } from "@/lib/auth-options";
import FinansiesClient from "@/components/admin/FinansiesClient";
import FinancialAnalyticsPanel from "@/components/admin/FinancialAnalyticsPanel";
import ClearSectionButton from "@/components/admin/ClearSectionButton";
import ExportButton from "@/components/admin/ExportButton";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { DEFAULT_CATEGORIES } from "@/lib/constants/default-categories";

export const dynamic = "force-dynamic";

export default async function FinansiesPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const { farmSlug } = await params;
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return <p>Farm not found.</p>;

  // Seed categories once — use createMany only if truly empty to avoid race duplicates
  // The API route handles seeding too; this ensures SSR also has categories ready
  const categoryCount = await prisma.transactionCategory.count();
  if (categoryCount === 0) {
    try {
      await prisma.transactionCategory.createMany({ data: DEFAULT_CATEGORIES });
    } catch {
      // Another request seeded concurrently — safe to ignore
    }
  }

  const [transactions, categories] = await Promise.all([
    prisma.transaction.findMany({ orderBy: { date: "desc" } }),
    prisma.transactionCategory.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] }),
  ]);

  const incomeCategories = categories.filter((c) => c.type === "income");
  const expenseCategories = categories.filter((c) => c.type === "expense");

  return (
    <div className="min-w-0 p-4 md:p-8 space-y-2 bg-[#FAFAF8]">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-[#1C1815]">Finance</h1>
          <div className="flex items-center gap-2">
            <ExportButton farmSlug={farmSlug} exportType="transactions" label="Export" />
            <ClearSectionButton endpoint="/api/transactions/reset" label="Clear All Transactions" />
          </div>
        </div>
        <FinansiesClient
          farmSlug={farmSlug}
          initialTransactions={transactions.map((t) => ({
            ...t,
            amount: t.amount,
          }))}
          initialIncome={incomeCategories}
          initialExpense={expenseCategories}
        />
        <Suspense fallback={<div className="mt-8 h-48 rounded-xl animate-pulse" style={{ background: "#F5F2EE" }} />}>
          <FinancialAnalyticsPanel farmSlug={farmSlug} />
        </Suspense>
    </div>
  );
}
