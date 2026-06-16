import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getProfitPerCamp } from "@/lib/server/profit-per-camp/get-profit-per-camp";
import ProfitPerCampTableClient from "@/components/admin/profit-per-camp/ProfitPerCampTableClient";

function fmtR(n: number): string {
  return `R ${Math.round(n).toLocaleString("en-ZA")}`;
}

export default async function ProfitPerCampSection({
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

  // Resolve the date range as YYYY-MM-DD strings (Transaction.date is a string
  // column filtered via string gte/lte). Default = trailing 365 days.
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const fromStr = from ?? defaultFrom.toISOString().slice(0, 10);
  const toStr = to ?? now.toISOString().slice(0, 10);

  const { rows, unallocated } = await getProfitPerCamp(prisma, farmSlug, {
    from: fromStr,
    to: toStr,
  });

  const periodLabel = from && to ? `${from} – ${to}` : "Last 365 days";

  const topEarner = rows.length > 0 ? rows[0] : null; // rows are sorted by profit DESC
  const farmTotalProfit = rows.reduce((s, r) => s + r.profit, 0);

  return (
    <div
      className="mt-6 rounded-xl p-4 md:p-6"
      style={{ background: "var(--ft-surface)", border: "1px solid var(--ft-border)" }}
    >
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--ft-text)" }}>
            Profit per Camp ({periodLabel})
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--ft-subtle)" }}>
            Sale income credits the sold animal&apos;s last camp; costs follow
            their camp or animal tag. Overhead with no tag is shown as a separate
            unallocated line — never spread across camps.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--ft-subtle)" }}>
          Log sales &amp; costs to unlock per-camp profit.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
            <div
              className="rounded-lg p-3"
              style={{ background: "var(--ft-bg)", border: "1px solid var(--ft-border)" }}
            >
              <p className="text-[11px] mb-1" style={{ color: "var(--ft-subtle)" }}>
                Top earner
              </p>
              <p
                className="text-base font-bold font-mono"
                style={{ color: "var(--ft-good)" }}
              >
                {topEarner ? topEarner.campName : "—"}
              </p>
              <p className="text-[11px] font-mono" style={{ color: "var(--ft-subtle)" }}>
                {topEarner ? fmtR(topEarner.profit) : ""}
              </p>
            </div>
            <div
              className="rounded-lg p-3"
              style={{ background: "var(--ft-bg)", border: "1px solid var(--ft-border)" }}
            >
              <p className="text-[11px] mb-1" style={{ color: "var(--ft-subtle)" }}>
                Attributed profit
              </p>
              <p
                className="text-base font-bold font-mono"
                style={{
                  color: farmTotalProfit >= 0 ? "var(--ft-good)" : "var(--ft-poor)",
                }}
              >
                {fmtR(farmTotalProfit)}
              </p>
            </div>
            <div
              className="rounded-lg p-3"
              style={{ background: "var(--ft-bg)", border: "1px solid var(--ft-border)" }}
            >
              <p className="text-[11px] mb-1" style={{ color: "var(--ft-subtle)" }}>
                Unallocated (net)
              </p>
              <p
                className="text-base font-bold font-mono"
                style={{
                  color: unallocated.net >= 0 ? "var(--ft-text)" : "var(--ft-poor)",
                }}
              >
                {fmtR(unallocated.net)}
              </p>
            </div>
          </div>

          <ProfitPerCampTableClient rows={rows} unallocated={unallocated} />
        </>
      )}
    </div>
  );
}
