// lib/server/export/camps.ts
// Camp summary exporter (CSV/PDF) — joins live conditions onto each camp.

import { getLatestCampConditions } from "@/lib/server/camp-status";
import { campsToCSV, type CampRow } from "@/lib/server/export-csv";
import type { ExportArtifact, ExportContext } from "./types";
import { buildPdf, csvFilename, pdfFilename } from "./pdf";

export async function exportCamps(ctx: ExportContext): Promise<ExportArtifact> {
  const [rawCamps, conditionMap] = await Promise.all([
    ctx.prisma.camp.findMany(),
    getLatestCampConditions(ctx.prisma),
  ]);

  const campRows: CampRow[] = rawCamps.map((c) => {
    const cond = conditionMap.get(c.campId);
    return {
      campId: c.campId,
      campName: c.campName,
      sizeHectares: c.sizeHectares ?? null,
      waterSource: c.waterSource ?? null,
      grazingQuality: cond?.grazing_quality ?? null,
      waterStatus: cond?.water_status ?? null,
      fenceStatus: cond?.fence_status ?? null,
      lastInspectedAt: cond?.last_inspected_at ?? null,
    };
  });

  if (ctx.format === "csv") {
    return {
      contentType: "text/csv",
      filename: csvFilename("camps"),
      body: campsToCSV(campRows),
    };
  }

  const pdfBuf = await buildPdf(
    "Camp Summary",
    ["Camp ID", "Camp Name", "Size (ha)", "Water Source", "Grazing Quality", "Water Status", "Fence Status", "Last Inspected"],
    campRows.map((c) => [
      c.campId,
      c.campName,
      c.sizeHectares,
      c.waterSource,
      c.grazingQuality,
      c.waterStatus,
      c.fenceStatus,
      c.lastInspectedAt,
    ]),
  );
  return {
    contentType: "application/pdf",
    filename: pdfFilename("camps"),
    body: pdfBuf,
  };
}
