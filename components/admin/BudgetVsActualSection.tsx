import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getBudgetVsActual, type BudgetVsActualRow } from "@/lib/server/financial-analytics";
import BudgetEditor from "@/components/admin/BudgetEditor";

function fmt(n: number): string {
  return `R ${Math.round(Math.abs(n)).toLocaleString("en-ZA")}`;
}

function statusColor(row: BudgetVsActualRow): string {
  const pct = row.variancePercent;
  if (row.type === "expense") {
    if (row.variance <= 0) return "#4A7C59";
    if (pct === null || pct > 10) return "#C0574C";
    return "#C98A2B";
  }
  if (row.variance >= 0) return "#4A7C59";
  if (pct === null || pct < -10) return "#C0574C";
  return "#C98A2B";
}

function BudgetTable({
  title,
  rows,
  emptyHint,
}: {
  title: string;
  rows: BudgetVsActualRow[];
  emptyHint: string;
}) {
  if (rows.length === 0) {
    return (
      <div>
        <h3 className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
          {title}
        </h3>
        <p className="text-sm" style={{ color: "#9C8E7A" }}>{emptyHint}</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
        {title}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: "#9C8E7A", borderBottom: "1px solid #E0D5C8" }}>
              <th className="text-left py-2 pr-3 font-medium">Category</th>
              <th className="text-right py-2 px-3 font-medium">Budget</th>
              <th className="text-right py-2 px-3 font-medium">Actual</th>
              <th className="text-right py-2 px-3 font-medium">Variance</th>
              <th className="text-right py-2 px-3 font-medium">%</th>
              <th className="w-4" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const color = statusColor(row);
              const pctLabel =
                row.variancePercent === null
                  ? "—"
                  : `${row.variancePercent > 0 ? "+" : ""}${row.variancePercent.toFixed(1)}%`;
              const varianceSign = row.variance > 0 ? "+" : row.variance < 0 ? "−" : "";
              return (
                <tr key={`${row.type}-${row.categoryName}`} style={{ borderBottom: "1px solid #F0EAE1" }}>
                  <td className="py-2 pr-3" style={{ color: "#1C1815" }}>{row.categoryName}</td>
                  <td className="py-2 px-3 text-right font-mono" style={{ color: "#1C1815" }}>
                    {row.budgeted > 0 ? fmt(row.budgeted) : <span style={{ color: "#9C8E7A" }}>—</span>}
                  </td>
                  <td className="py-2 px-3 text-right font-mono" style={{ color: "#1C1815" }}>
                    {fmt(row.actual)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono" style={{ color }}>
                    {row.budgeted > 0 ? `${varianceSign}${fmt(row.variance)}` : <span style={{ color: "#9C8E7A" }}>—</span>}
                  </td>
                  <td className="py-2 px-3 text-right font-mono" style={{ color }}>
                    {pctLabel}
                  </td>
                  <td className="py-2 pl-2">
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ background: color }}
                      aria-hidden
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function BudgetVsActualSection({
  farmSlug,
  from,
  to,
}: {
  farmSlug: string;
  from?: string;
  to?: string;
}) {
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return null;

  const now = new Date();
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), 11, 31));

  const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : defaultFrom;
  const toDate = to ? new Date(`${to}T23:59:59.999Z`) : defaultTo;

  const [rows, categories] = await Promise.all([
    getBudgetVsActual(prisma, fromDate, toDate),
    prisma.transactionCategory.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: { id: true, name: true, type: true },
    }),
  ]);

  const expenseRows = rows.filter((r) => r.type === "expense");
  const incomeRows = rows.filter((r) => r.type === "income");

  const periodLabel =
    from && to ? `${from} – ${to}` : `${now.getUTCFullYear()} (year to date)`;

  const totalBudgetExpense = expenseRows.reduce((s, r) => s + r.budgeted, 0);
  const totalActualExpense = expenseRows.reduce((s, r) => s + r.actual, 0);
  const totalBudgetIncome = incomeRows.reduce((s, r) => s + r.budgeted, 0);
  const totalActualIncome = incomeRows.reduce((s, r) => s + r.actual, 0);
  const hasAnyBudget = totalBudgetExpense + totalBudgetIncome > 0;

  return (
    <div
      className="mt-6 rounded-xl p-4 md:p-6"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
          Budget vs Actual ({periodLabel})
        </h2>
        <BudgetEditor farmSlug={farmSlug} categories={categories} />
      </div>

      {!hasAnyBudget ? (
        <p className="text-sm" style={{ color: "#9C8E7A" }}>
          No budgets set yet. Click <span className="font-medium">Set Budgets</span> to enter monthly
          targets per category and start tracking variance.
        </p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg p-3" style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}>
              <p className="text-[11px] mb-1" style={{ color: "#9C8E7A" }}>Expense Budget</p>
              <p className="text-base font-bold font-mono" style={{ color: "#1C1815" }}>{fmt(totalBudgetExpense)}</p>
            </div>
            <div className="rounded-lg p-3" style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}>
              <p className="text-[11px] mb-1" style={{ color: "#9C8E7A" }}>Expense Actual</p>
              <p
                className="text-base font-bold font-mono"
                style={{ color: totalActualExpense > totalBudgetExpense && totalBudgetExpense > 0 ? "#C0574C" : "#1C1815" }}
              >
                {fmt(totalActualExpense)}
              </p>
            </div>
            <div className="rounded-lg p-3" style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}>
              <p className="text-[11px] mb-1" style={{ color: "#9C8E7A" }}>Income Budget</p>
              <p className="text-base font-bold font-mono" style={{ color: "#1C1815" }}>{fmt(totalBudgetIncome)}</p>
            </div>
            <div className="rounded-lg p-3" style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}>
              <p className="text-[11px] mb-1" style={{ color: "#9C8E7A" }}>Income Actual</p>
              <p
                className="text-base font-bold font-mono"
                style={{ color: totalActualIncome < totalBudgetIncome && totalBudgetIncome > 0 ? "#C0574C" : "#4A7C59" }}
              >
                {fmt(totalActualIncome)}
              </p>
            </div>
          </div>

          <BudgetTable title="Expenses" rows={expenseRows} emptyHint="No expense budgets or actuals in this period." />
          <BudgetTable title="Income" rows={incomeRows} emptyHint="No income budgets or actuals in this period." />
        </div>
      )}
    </div>
  );
}
