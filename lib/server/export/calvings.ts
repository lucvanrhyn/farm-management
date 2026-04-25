// lib/server/export/calvings.ts
// Upcoming calvings exporter (CSV/PDF).

import { getReproStats } from "@/lib/server/reproduction-analytics";
import { calvingsToCSV } from "@/lib/server/export-csv";
import type { ExportArtifact, ExportContext } from "./types";
import { buildPdf, csvFilename, pdfFilename } from "./pdf";

function urgencyLabel(daysAway: number): string {
  if (daysAway < 0) return "Overdue";
  if (daysAway <= 7) return "Due in 7 days";
  if (daysAway <= 14) return "Due in 14 days";
  return "Upcoming";
}

export async function exportCalvings(ctx: ExportContext): Promise<ExportArtifact> {
  const stats = await getReproStats(ctx.prisma);
  const calvings = stats.upcomingCalvings;

  if (ctx.format === "csv") {
    return {
      contentType: "text/csv",
      filename: csvFilename("calvings"),
      body: calvingsToCSV(calvings),
    };
  }

  const pdfBuf = await buildPdf(
    "Upcoming Calvings",
    ["Animal ID", "Camp ID", "Camp Name", "Expected Calving", "Days Away", "Source", "Urgency"],
    calvings.map((c) => [
      c.animalId,
      c.campId,
      c.campName,
      c.expectedCalving.toISOString().slice(0, 10),
      c.daysAway,
      c.source,
      urgencyLabel(c.daysAway),
    ]),
  );
  return {
    contentType: "application/pdf",
    filename: pdfFilename("calvings"),
    body: pdfBuf,
  };
}
