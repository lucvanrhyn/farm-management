export const dynamic = "force-dynamic";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { authOptions } from "@/lib/auth-options";
import FinansiesClient from "@/components/admin/FinansiesClient";
import FinancialAnalyticsPanelLazy from "@/components/admin/FinancialAnalyticsPanelLazy";
import FinancialChartsSection from "@/components/admin/FinancialChartsSection";
import FinancialKPISection from "@/components/admin/FinancialKPISection";
import BudgetVsActualSection from "@/components/admin/BudgetVsActualSection";
import CostOfGainSection from "@/components/admin/CostOfGainSection";
import ClearSectionButton from "@/components/admin/ClearSectionButton";
import ExportButton from "@/components/admin/ExportButton";
import DateRangePicker from "@/components/admin/DateRangePicker";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { DEFAULT_CATEGORIES } from "@/lib/constants/default-categories";
import { getFarmCreds } from "@/lib/meta-db";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import AdminPage from "@/app/_components/AdminPage";

// Finance transactions page size. 50 keeps the initial HTML payload bounded
// while the visible ledger (TransactionLedger) is ordered newest-first, so
// users looking at recent activity never need to "Load more". The ledger's
// in-page filters work over whatever window the SSR returned; streaming
// older transactions via cursor-pagination is tracked as a follow-up.
const PAGE_SIZE = 50;

export default async function FinansiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ farmSlug: string }>;
  searchParams?: Promise<{ from?: string; to?: string; cogScope?: string; cursor?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const { farmSlug } = await params;
  const { from, to, cogScope, cursor } = searchParams ? await searchParams : {};

  const creds = await getFarmCreds(farmSlug);
  if (creds?.tier === "basic") {
    return <UpgradePrompt feature="Finance" farmSlug={farmSlug} />;
  }

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
    prisma.transaction.findMany({
      // Newest first. Secondary sort on `id desc` gives us a deterministic
      // total order even when two rows share the exact same `date`, which
      // matters for stable cursor pagination.
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: PAGE_SIZE,
      ...(cursor
        ? { cursor: { id: cursor }, skip: 1 }
        : {}),
    }),
    // audit-allow-findmany: category list is bounded (~30 default categories per farm).
    prisma.transactionCategory.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] }),
  ]);

  const incomeCategories = categories.filter((c) => c.type === "income");
  const expenseCategories = categories.filter((c) => c.type === "expense");

  return (
    <AdminPage className="space-y-2">
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
        <div className="mb-4">
          <Suspense fallback={<div className="h-9" />}>
            <DateRangePicker defaultDays={365} />
          </Suspense>
        </div>
        <Suspense fallback={<div className="mt-8 h-48 rounded-xl animate-pulse" style={{ background: "#F5F2EE" }} />}>
          <FinancialKPISection farmSlug={farmSlug} from={from} to={to} />
        </Suspense>
        <Suspense fallback={<div className="mt-8 h-48 rounded-xl animate-pulse" style={{ background: "#F5F2EE" }} />}>
          <BudgetVsActualSection farmSlug={farmSlug} from={from} to={to} />
        </Suspense>
        <Suspense fallback={<div className="mt-8 h-48 rounded-xl animate-pulse" style={{ background: "#F5F2EE" }} />}>
          <CostOfGainSection farmSlug={farmSlug} from={from} to={to} cogScope={cogScope} />
        </Suspense>
        <FinancialAnalyticsPanelLazy farmSlug={farmSlug} />
        <Suspense fallback={<div className="mt-8 h-48 rounded-xl animate-pulse" style={{ background: "#F5F2EE" }} />}>
          <FinancialChartsSection farmSlug={farmSlug} from={from} to={to} />
        </Suspense>
    </AdminPage>
  );
}
