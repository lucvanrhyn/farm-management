import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getBudgetVsActual, type BudgetVsActualRow } from "@/lib/server/financial-analytics";
import BudgetEditor from "@/components/admin/BudgetEditor";

function fmt(n: number): string {
  return `R ${Math.round(Math.abs(n)).toLocaleString("en-ZA")}`;
}

function statusColor(row: BudgetVsActualRow): string {
  const pct = row.variancePercent;
  if (row.type === "expense") {
    if (row.variance <= 0) return "var(--ft-good)";
    if (pct === null || pct > 10) return "var(--ft-poor)";
    return "var(--ft-fair)";
  }
  if (row.variance >= 0) return "var(--ft-good)";
  if (pct === null || pct < -10) return "var(--ft-poor)";
  return "var(--ft-fair)";
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
        <h3 className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--ft-subtle)" }}>
          {title}
        </h3>
        <p className="text-sm" style={{ color: "var(--ft-subtle)" }}>{emptyHint}</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--ft-subtle)" }}>
        {title}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: "var(--ft-subtle)", borderBottom: "1px solid var(--ft-border)" }}>
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
                <tr key={`${row.type}-${row.categoryName}`} style={{ borderBottom: "1px solid var(--ft-surface2)" }}>
                  <td className="py-2 pr-3" style={{ color: "var(--ft-text)" }}>{row.categoryName}</td>
                  <td className="py-2 px-3 text-right font-mono" style={{ color: "var(--ft-text)" }}>
                    {row.budgeted > 0 ? fmt(row.budgeted) : <span style={{ color: "var(--ft-subtle)" }}>—</span>}
                  </td>
                  <td className="py-2 px-3 text-right font-mono" style={{ color: "var(--ft-text)" }}>
                    {fmt(row.actual)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono" style={{ color }}>
                    {row.budgeted > 0 ? `${varianceSign}${fmt(row.variance)}` : <span style={{ color: "var(--ft-subtle)" }}>—</span>}
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
      style={{ background: "var(--ft-surface)", border: "1px solid var(--ft-border)" }}
    >
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="text-sm font-semibold" style={{ color: "var(--ft-text)" }}>
          Budget vs Actual ({periodLabel})
        </h2>
        <BudgetEditor farmSlug={farmSlug} categories={categories} />
      </div>

      {!hasAnyBudget ? (
        <p className="text-sm" style={{ color: "var(--ft-subtle)" }}>
          No budgets set yet. Click <span className="font-medium">Set Budgets</span> to enter monthly
          targets per category and start tracking variance.
        </p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg p-3" style={{ background: "var(--ft-bg)", border: "1px solid var(--ft-border)" }}>
              <p className="text-[11px] mb-1" style={{ color: "var(--ft-subtle)" }}>Expense Budget</p>
              <p className="text-base font-bold font-mono" style={{ color: "var(--ft-text)" }}>{fmt(totalBudgetExpense)}</p>
            </div>
            <div className="rounded-lg p-3" style={{ background: "var(--ft-bg)", border: "1px solid var(--ft-border)" }}>
              <p className="text-[11px] mb-1" style={{ color: "var(--ft-subtle)" }}>Expense Actual</p>
              <p
                className="text-base font-bold font-mono"
                style={{ color: totalActualExpense > totalBudgetExpense && totalBudgetExpense > 0 ? "var(--ft-poor)" : "var(--ft-text)" }}
              >
                {fmt(totalActualExpense)}
              </p>
            </div>
            <div className="rounded-lg p-3" style={{ background: "var(--ft-bg)", border: "1px solid var(--ft-border)" }}>
              <p className="text-[11px] mb-1" style={{ color: "var(--ft-subtle)" }}>Income Budget</p>
              <p className="text-base font-bold font-mono" style={{ color: "var(--ft-text)" }}>{fmt(totalBudgetIncome)}</p>
            </div>
            <div className="rounded-lg p-3" style={{ background: "var(--ft-bg)", border: "1px solid var(--ft-border)" }}>
              <p className="text-[11px] mb-1" style={{ color: "var(--ft-subtle)" }}>Income Actual</p>
              <p
                className="text-base font-bold font-mono"
                style={{ color: totalActualIncome < totalBudgetIncome && totalBudgetIncome > 0 ? "var(--ft-poor)" : "var(--ft-good)" }}
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
