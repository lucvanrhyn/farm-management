// lib/server/export/reproduction.ts
// Reproduction summary exporter (CSV/PDF) — KPI roll-up vs SA benchmarks.

import { getReproStats } from "@/lib/server/reproduction-analytics";
import { reproSummaryToCSV, type ReproSummaryRow } from "@/lib/server/export-csv";
import type { ExportArtifact, ExportContext } from "./types";
import { buildPdf, csvFilename, pdfFilename } from "./pdf";

export async function exportReproduction(ctx: ExportContext): Promise<ExportArtifact> {
  const stats = await getReproStats(ctx.prisma);

  const rows: ReproSummaryRow[] = [
    {
      metric: "Pregnancy Rate",
      value: stats.pregnancyRate != null ? `${stats.pregnancyRate.toFixed(1)}%` : "N/A",
      benchmark: "≥85%",
    },
    {
      metric: "Calving Rate",
      value: stats.calvingRate != null ? `${stats.calvingRate.toFixed(1)}%` : "N/A",
      benchmark: "≥85%",
    },
    {
      metric: "Avg Calving Interval",
      value: stats.avgCalvingIntervalDays != null ? `${Math.round(stats.avgCalvingIntervalDays)} days` : "N/A",
      benchmark: "≤365 days",
    },
    {
      metric: "Upcoming Calvings (next 90d)",
      value: String(stats.upcomingCalvings.length),
      benchmark: "—",
    },
    {
      metric: "In Heat (7d)",
      value: String(stats.inHeat7d),
      benchmark: "—",
    },
  ];

  if (ctx.format === "csv") {
    return {
      contentType: "text/csv",
      filename: csvFilename("reproduction"),
      body: reproSummaryToCSV(rows),
    };
  }

  const pdfBuf = await buildPdf(
    "Reproduction Summary",
    ["Metric", "Value", "SA Benchmark"],
    rows.map((r) => [r.metric, r.value, r.benchmark]),
  );
  return {
    contentType: "application/pdf",
    filename: pdfFilename("reproduction"),
    body: pdfBuf,
  };
}
