// lib/server/export/withdrawal.ts
// Treatment & withdrawal exporter (CSV/PDF).

import { getAnimalsInWithdrawal } from "@/lib/server/treatment-analytics";
import { withdrawalToCSV } from "@/lib/server/export-csv";
import type { ExportArtifact, ExportContext } from "./types";
import { buildPdf, csvFilename, pdfFilename } from "./pdf";

export async function exportWithdrawal(ctx: ExportContext): Promise<ExportArtifact> {
  const animals = await getAnimalsInWithdrawal(ctx.prisma);

  if (ctx.format === "csv") {
    return {
      contentType: "text/csv",
      filename: csvFilename("withdrawal"),
      body: withdrawalToCSV(animals),
    };
  }

  const pdfBuf = await buildPdf(
    "Treatment & Withdrawal",
    ["Animal ID", "Name", "Camp", "Treatment Type", "Treated Date", "Withdrawal Ends", "Days Remaining"],
    animals.map((a) => [
      a.animalId,
      a.name,
      a.campId,
      a.treatmentType,
      a.treatedAt.toISOString().slice(0, 10),
      a.withdrawalEndsAt.toISOString().slice(0, 10),
      a.daysRemaining,
    ]),
  );
  return {
    contentType: "application/pdf",
    filename: pdfFilename("withdrawal"),
    body: pdfBuf,
  };
}
