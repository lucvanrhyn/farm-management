import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import AdminNav from "@/components/admin/AdminNav";
import FinansiesClient from "@/components/admin/FinansiesClient";
import ClearSectionButton from "@/components/admin/ClearSectionButton";
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
    <div className="flex min-h-screen bg-[#FAFAF8]">
      <AdminNav />
      <main className="flex-1 p-4 md:p-8 space-y-2">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-[#1C1815]">Finance</h1>
          <ClearSectionButton endpoint="/api/transactions/reset" label="Clear All Transactions" />
        </div>
        <FinansiesClient
          initialTransactions={transactions.map((t) => ({
            ...t,
            amount: t.amount,
          }))}
          initialIncome={incomeCategories}
          initialExpense={expenseCategories}
        />
      </main>
    </div>
  );
}
