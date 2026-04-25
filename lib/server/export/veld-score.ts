// lib/server/export/veld-score.ts
// Farm-level Veld Condition Scoring exporter (CSV/PDF).

import { getFarmSummary as getVeldFarmSummary } from "@/lib/server/veld-score";
import { veldScoreToCSV, type VeldScoreRow } from "@/lib/server/export-csv";
import type { ExportArtifact, ExportContext } from "./types";
import { buildPdf, csvFilename, pdfFilename } from "./pdf";

export async function exportVeldScore(ctx: ExportContext): Promise<ExportArtifact> {
  const summary = await getVeldFarmSummary(ctx.prisma);
  const rows: VeldScoreRow[] = summary.byCamp.map((c) => ({
    campId: c.campId,
    latestDate: c.latestDate,
    assessor: c.assessor,
    veldScore: c.latestScore,
    haPerLsu: c.haPerLsu,
    trendSlope: c.trendSlope,
    daysSinceAssessment: c.daysSinceAssessment,
  }));

  if (ctx.format === "csv") {
    return {
      contentType: "text/csv",
      filename: csvFilename("veld-score"),
      body: veldScoreToCSV(rows),
    };
  }

  const pdfBuf = await buildPdf(
    "Farm Veld Condition Summary",
    ["Camp", "Latest Date", "Assessor", "Score", "ha/LSU", "Trend/mo", "Days Since"],
    rows.map((r) => [
      r.campId,
      r.latestDate,
      r.assessor,
      r.veldScore,
      r.haPerLsu != null ? r.haPerLsu.toFixed(2) : null,
      r.trendSlope.toFixed(3),
      r.daysSinceAssessment,
    ]),
  );
  return {
    contentType: "application/pdf",
    filename: pdfFilename("veld-score"),
    body: pdfBuf,
  };
}
