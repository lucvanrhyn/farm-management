// lib/server/export/drought.ts
// Drought / monthly-SPI exporter (CSV/PDF). Requires farm lat/lng to be
// configured in FarmSettings.

import { getDroughtPayload } from "@/lib/server/drought";
import { droughtMonthlyToCSV } from "@/lib/server/export-csv";
import type { ExportArtifact, ExportContext } from "./types";
import { ExportRequestError } from "./types";
import { buildPdf, csvFilename, pdfFilename } from "./pdf";

export async function exportDrought(ctx: ExportContext): Promise<ExportArtifact> {
  const settings = await ctx.prisma.farmSettings.findFirst({
    select: { latitude: true, longitude: true },
  });
  const lat = settings?.latitude ?? null;
  const lng = settings?.longitude ?? null;

  if (lat == null || lng == null) {
    throw new ExportRequestError(400, "Farm location not configured. Set latitude and longitude in Settings.");
  }

  const payload = await getDroughtPayload(ctx.prisma, lat, lng);

  if (ctx.format === "csv") {
    return {
      contentType: "text/csv",
      filename: csvFilename("drought"),
      body: droughtMonthlyToCSV(payload.monthly),
    };
  }

  const pdfBuf = await buildPdf(
    "Drought Tracking — Monthly SPI",
    ["Month", "Actual (mm)", "Normal (mm)", "Deviation (mm)", "SPI", "Severity", "Source"],
    payload.monthly.map((r) => [
      r.month,
      r.actualMm.toFixed(1),
      r.normalMm.toFixed(1),
      (r.actualMm - r.normalMm).toFixed(1),
      r.spi.toFixed(2),
      r.severity,
      r.source,
    ]),
  );
  return {
    contentType: "application/pdf",
    filename: pdfFilename("drought"),
    body: pdfBuf,
  };
}
