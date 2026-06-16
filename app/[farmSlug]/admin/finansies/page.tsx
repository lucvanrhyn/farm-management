export const dynamic = "force-dynamic";
import { Suspense } from "react";
import { requireSession } from "@/lib/auth";
import FinansiesClient from "@/components/admin/FinansiesClient";
import FinancialAnalyticsPanelLazy from "@/components/admin/FinancialAnalyticsPanelLazy";
import FinancialChartsSection from "@/components/admin/FinancialChartsSection";
import FinancialKPISection from "@/components/admin/FinancialKPISection";
import BudgetVsActualSection from "@/components/admin/BudgetVsActualSection";
import CostOfGainSection from "@/components/admin/CostOfGainSection";
import ProfitPerCampSection from "@/components/admin/ProfitPerCampSection";
import ClearSectionButton from "@/components/admin/ClearSectionButton";
import ExportButton from "@/components/admin/ExportButton";
import DateRangePicker from "@/components/admin/DateRangePicker";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { DEFAULT_CATEGORIES } from "@/lib/constants/default-categories";
import { getFarmCreds } from "@/lib/meta-db";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import AdminPage from "@/app/_components/AdminPage";
import { PageHeader } from "@/components/ds";

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
  const { farmSlug } = await params;

  await requireSession(`/${farmSlug}/admin/finansies`);

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
        <PageHeader
          className="px-0 py-0 mb-6"
          title="Finance"
          subtitle="finance ledger"
          right={
            <div className="flex items-center gap-2">
              <ExportButton farmSlug={farmSlug} exportType="transactions" label="Export" />
            </div>
          }
        />
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
        <Suspense fallback={<div className="mt-8 h-48 rounded-xl animate-pulse" style={{ background: "var(--ft-surface)" }} />}>
          <FinancialKPISection farmSlug={farmSlug} from={from} to={to} />
        </Suspense>
        <Suspense fallback={<div className="mt-8 h-48 rounded-xl animate-pulse" style={{ background: "var(--ft-surface)" }} />}>
          <BudgetVsActualSection farmSlug={farmSlug} from={from} to={to} />
        </Suspense>
        <Suspense fallback={<div className="mt-8 h-48 rounded-xl animate-pulse" style={{ background: "var(--ft-surface)" }} />}>
          <CostOfGainSection farmSlug={farmSlug} from={from} to={to} cogScope={cogScope} />
        </Suspense>
        <Suspense fallback={<div className="mt-8 h-48 rounded-xl animate-pulse" style={{ background: "var(--ft-surface)" }} />}>
          <ProfitPerCampSection farmSlug={farmSlug} from={from} to={to} />
        </Suspense>
        <FinancialAnalyticsPanelLazy farmSlug={farmSlug} />
        <Suspense fallback={<div className="mt-8 h-48 rounded-xl animate-pulse" style={{ background: "var(--ft-surface)" }} />}>
          <FinancialChartsSection farmSlug={farmSlug} from={from} to={to} />
        </Suspense>
        {/*
          Wave C / U4 — see animals/page.tsx for full rationale. Danger zone
          sits at the bottom so destroying the entire transactions ledger is
          an intentional end-of-page action.
        */}
        <div
          data-testid="danger-zone"
          className="mt-12 pt-6 border-t border-[var(--ft-surface2)]"
        >
          <p
            className="text-xs uppercase tracking-wider mb-3"
            style={{ color: "var(--ft-subtle)" }}
          >
            Danger zone
          </p>
          <ClearSectionButton endpoint="/api/transactions/reset" label="Clear All Transactions" />
        </div>
    </AdminPage>
  );
}
