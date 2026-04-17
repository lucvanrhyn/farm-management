import { redirect } from "next/navigation";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getSession, getUserRoleForFarm } from "@/lib/auth";

export const dynamic = "force-dynamic";

const zarFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "ZAR",
  minimumFractionDigits: 2,
});

function formatZar(value: number | null | undefined): string {
  return zarFormatter.format(value ?? 0);
}

function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

export default async function TelemetryPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  // Defense-in-depth: enforce ADMIN at the page level even though layout also guards.
  const session = await getSession();
  if (!session || getUserRoleForFarm(session, farmSlug) !== "ADMIN") {
    redirect(`/${farmSlug}/home`);
  }

  const prisma = await getPrismaForFarm(farmSlug);

  if (!prisma) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-red-500">Farm not found.</p>
      </div>
    );
  }

  const [totalImports, aggregates, jobs] = await Promise.all([
    prisma.importJob.count(),
    prisma.importJob.aggregate({
      _sum: {
        costZar: true,
        inputTokens: true,
        cachedTokens: true,
        outputTokens: true,
        rowsImported: true,
        rowsFailed: true,
      },
      _avg: { costZar: true },
    }),
    prisma.importJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        sourceFilename: true,
        rowsImported: true,
        rowsFailed: true,
        inputTokens: true,
        outputTokens: true,
        cachedTokens: true,
        costZar: true,
        createdAt: true,
      },
    }),
  ]);

  const totalCost = aggregates._sum.costZar ?? 0;
  const avgCost = aggregates._avg.costZar ?? 0;
  const totalInputTokens = aggregates._sum.inputTokens ?? 0;
  const totalCachedTokens = aggregates._sum.cachedTokens ?? 0;
  const totalInputWithCache = totalInputTokens + totalCachedTokens;
  const hitRate =
    totalInputWithCache > 0 ? (totalCachedTokens / totalInputWithCache) * 100 : 0;

  const cardStyle = {
    background: "#FFFFFF",
    border: "1px solid #E0D5C8",
  } as const;

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-[#1C1815]">AI Import Telemetry</h1>
        <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
          Cost & usage dashboard for AI-powered data imports
        </p>
      </div>

      {totalImports === 0 ? (
        <div className="rounded-2xl p-8 text-center" style={cardStyle}>
          <p className="text-sm text-[#1C1815] font-medium">No imports yet</p>
          <p className="text-xs mt-2 font-mono" style={{ color: "#9C8E7A" }}>
            Data will appear here after your first AI import.
          </p>
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
            <div className="rounded-2xl p-4" style={cardStyle}>
              <p
                className="text-[10px] uppercase tracking-wider font-mono mb-2"
                style={{ color: "#9C8E7A" }}
              >
                Total Imports
              </p>
              <p className="text-2xl font-bold text-[#1C1815]">
                {formatNumber(totalImports)}
              </p>
              <p className="text-[10px] mt-1 font-mono" style={{ color: "#9C8E7A" }}>
                {formatNumber(aggregates._sum.rowsImported)} rows imported
              </p>
            </div>

            <div className="rounded-2xl p-4" style={cardStyle}>
              <p
                className="text-[10px] uppercase tracking-wider font-mono mb-2"
                style={{ color: "#9C8E7A" }}
              >
                Total Cost
              </p>
              <p className="text-2xl font-bold" style={{ color: "#8B6914" }}>
                {formatZar(totalCost)}
              </p>
              <p className="text-[10px] mt-1 font-mono" style={{ color: "#9C8E7A" }}>
                lifetime
              </p>
            </div>

            <div className="rounded-2xl p-4" style={cardStyle}>
              <p
                className="text-[10px] uppercase tracking-wider font-mono mb-2"
                style={{ color: "#9C8E7A" }}
              >
                Avg Cost / Import
              </p>
              <p className="text-2xl font-bold text-[#1C1815]">
                {formatZar(avgCost)}
              </p>
              <p className="text-[10px] mt-1 font-mono" style={{ color: "#9C8E7A" }}>
                per job
              </p>
            </div>

            <div className="rounded-2xl p-4" style={cardStyle}>
              <p
                className="text-[10px] uppercase tracking-wider font-mono mb-2"
                style={{ color: "#9C8E7A" }}
              >
                Cache Hit Rate
              </p>
              <p className="text-2xl font-bold" style={{ color: "#8B6914" }}>
                {hitRate.toFixed(1)}%
              </p>
              <p className="text-[10px] mt-1 font-mono" style={{ color: "#9C8E7A" }}>
                {formatNumber(totalCachedTokens)} / {formatNumber(totalInputWithCache)} tokens
              </p>
            </div>
          </div>

          {/* Recent imports table */}
          <div className="rounded-2xl overflow-hidden" style={cardStyle}>
            <div
              className="px-4 py-3"
              style={{ borderBottom: "1px solid #E0D5C8" }}
            >
              <h2 className="text-sm font-semibold text-[#1C1815]">Recent Imports</h2>
              <p
                className="text-[10px] mt-0.5 font-mono"
                style={{ color: "#9C8E7A" }}
              >
                Last {jobs.length} of {formatNumber(totalImports)}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-left text-[10px] uppercase tracking-wider font-mono"
                    style={{ color: "#9C8E7A", background: "#FAFAF8" }}
                  >
                    <th className="px-4 py-2 font-normal">Date</th>
                    <th className="px-4 py-2 font-normal">Filename</th>
                    <th className="px-4 py-2 font-normal text-right">Rows</th>
                    <th className="px-4 py-2 font-normal text-right">Tokens</th>
                    <th className="px-4 py-2 font-normal text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job, idx) => {
                    const totalTokens =
                      (job.inputTokens ?? 0) +
                      (job.outputTokens ?? 0) +
                      (job.cachedTokens ?? 0);
                    return (
                      <tr
                        key={job.id}
                        style={{
                          borderTop:
                            idx === 0 ? undefined : "1px solid #F0E8DC",
                        }}
                      >
                        <td
                          className="px-4 py-3 font-mono text-xs"
                          style={{ color: "#1C1815" }}
                        >
                          {formatDate(job.createdAt)}
                        </td>
                        <td
                          className="px-4 py-3 text-xs truncate max-w-[240px]"
                          style={{ color: "#1C1815" }}
                          title={job.sourceFilename}
                        >
                          {job.sourceFilename}
                        </td>
                        <td
                          className="px-4 py-3 font-mono text-xs text-right"
                          style={{ color: "#1C1815" }}
                        >
                          {formatNumber(job.rowsImported)}
                          {job.rowsFailed > 0 && (
                            <span className="ml-1 text-red-500">
                              (−{formatNumber(job.rowsFailed)})
                            </span>
                          )}
                        </td>
                        <td
                          className="px-4 py-3 font-mono text-xs text-right"
                          style={{ color: "#1C1815" }}
                        >
                          {formatNumber(totalTokens)}
                        </td>
                        <td
                          className="px-4 py-3 font-mono text-xs text-right font-semibold"
                          style={{ color: "#8B6914" }}
                        >
                          {formatZar(job.costZar)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
