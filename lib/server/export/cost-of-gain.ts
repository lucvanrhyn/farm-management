// lib/server/export/cost-of-gain.ts
// Cost of Gain exporter (CSV/PDF). Two views: by-camp (default) and by-animal.
// Scope: lifetime/12mo/quarter/all (validated via isCogScope).

import { isCogScope } from "@/lib/calculators/cost-of-gain";
import { getCogByAnimal, getCogByCamp } from "@/lib/server/financial-analytics";
import { cogByAnimalToCSV, cogByCampToCSV } from "@/lib/server/export-csv";
import type { ExportArtifact, ExportContext } from "./types";
import { buildPdf, csvFilename, pdfFilename } from "./pdf";

export async function exportCostOfGain(ctx: ExportContext): Promise<ExportArtifact> {
  const view = ctx.url.searchParams.get("view") ?? "camp";
  const scopeRaw = ctx.url.searchParams.get("scope");
  const scope = isCogScope(scopeRaw) ? scopeRaw : "all";

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const fromDate = ctx.from ? new Date(`${ctx.from}T00:00:00.000Z`) : defaultFrom;
  const toDate = ctx.to ? new Date(`${ctx.to}T23:59:59.999Z`) : now;

  if (view === "animal") {
    const rows = await getCogByAnimal(ctx.prisma, fromDate, toDate, scope, 500);
    if (ctx.format === "csv") {
      return {
        contentType: "text/csv",
        filename: csvFilename(`cost-of-gain-by-animal-${scope}`),
        body: cogByAnimalToCSV(rows),
      };
    }
    const pdfBuf = await buildPdf(
      `Cost of Gain — By Animal (${scope})`,
      ["Animal ID", "Name", "Category", "Camp", "Cost (R)", "Gain (kg)", "COG (R/kg)"],
      rows.map((r) => [
        r.animalId,
        r.name ?? "",
        r.category,
        r.currentCamp,
        r.totalCost.toFixed(2),
        r.kgGained.toFixed(1),
        r.costOfGain === null ? "—" : r.costOfGain.toFixed(2),
      ]),
    );
    return {
      contentType: "application/pdf",
      filename: pdfFilename(`cost-of-gain-by-animal-${scope}`),
      body: pdfBuf,
    };
  }

  const rows = await getCogByCamp(ctx.prisma, fromDate, toDate, scope);
  if (ctx.format === "csv") {
    return {
      contentType: "text/csv",
      filename: csvFilename(`cost-of-gain-by-camp-${scope}`),
      body: cogByCampToCSV(rows),
    };
  }
  const pdfBuf = await buildPdf(
    `Cost of Gain — By Camp (${scope})`,
    ["Camp ID", "Camp Name", "Ha", "Animals", "Cost (R)", "Gain (kg)", "COG (R/kg)"],
    rows.map((r) => [
      r.campId,
      r.campName,
      r.hectares ?? "",
      r.activeAnimalCount,
      r.totalCost.toFixed(2),
      r.kgGained.toFixed(1),
      r.costOfGain === null ? "—" : r.costOfGain.toFixed(2),
    ]),
  );
  return {
    contentType: "application/pdf",
    filename: pdfFilename(`cost-of-gain-by-camp-${scope}`),
    body: pdfBuf,
  };
}
