// lib/server/export/sars-it3.ts
// SARS IT3 tax export (CSV/PDF). Always reads from a non-voided stored
// snapshot — never re-aggregates transactions inline so the downloaded
// document matches the one the farmer filed.

import { parseStoredPayload } from "@/lib/server/sars-it3";
import { buildIt3Pdf } from "@/lib/server/sars-it3-pdf";
import { it3SnapshotToCSV } from "@/lib/server/export-csv";
import type { ExportArtifact, ExportContext } from "./types";
import { ExportRequestError } from "./types";
import { csvFilename, pdfFilename } from "./pdf";

export async function exportSarsIt3(ctx: ExportContext): Promise<ExportArtifact> {
  const taxYearRaw = ctx.url.searchParams.get("taxYear");
  const taxYear = taxYearRaw ? parseInt(taxYearRaw, 10) : NaN;
  if (!Number.isFinite(taxYear)) {
    throw new ExportRequestError(400, "taxYear query parameter is required for sars-it3 export");
  }

  // Always export from a stored, non-voided snapshot — never re-aggregate
  // transactions here. Farmers must issue a snapshot first so the return
  // they download matches the one they filed.
  const snapshot = await ctx.prisma.it3Snapshot.findFirst({
    where: { taxYear, voidedAt: null },
    orderBy: { issuedAt: "desc" },
  });
  if (!snapshot) {
    throw new ExportRequestError(
      404,
      `No active IT3 snapshot found for tax year ${taxYear}. Issue one from the Tax tools page first.`,
    );
  }

  if (ctx.format === "csv") {
    const payload = parseStoredPayload(snapshot.payload);
    return {
      contentType: "text/csv",
      filename: csvFilename(`sars-it3-${taxYear}`),
      body: it3SnapshotToCSV(payload),
    };
  }

  const pdfBuf = buildIt3Pdf({
    taxYear: snapshot.taxYear,
    issuedAt: snapshot.issuedAt,
    payload: snapshot.payload,
    generatedBy: snapshot.generatedBy,
    pdfHash: snapshot.pdfHash,
    voidedAt: snapshot.voidedAt,
    voidReason: snapshot.voidReason,
  });
  return {
    contentType: "application/pdf",
    filename: pdfFilename(`sars-it3-${taxYear}`),
    body: pdfBuf,
  };
}
