// lib/server/export/animals.ts
// Animal list exporter (CSV/PDF).

import { animalsToCSV } from "@/lib/server/export-csv";
import type { ExportArtifact, ExportContext } from "./types";
import { buildPdf, csvFilename, pdfFilename } from "./pdf";

export async function exportAnimals(ctx: ExportContext): Promise<ExportArtifact> {
  // cross-species by design: legacy bulk-animal export ships every species
  // (route does not receive a species filter). Phase G follow-up may add a
  // `?species=` parameter to align with the species-scoped admin pages.
  const animals = await ctx.prisma.animal.findMany({
    where: { status: "Active" },
    orderBy: { animalId: "asc" },
  });

  if (ctx.format === "csv") {
    return {
      contentType: "text/csv",
      filename: csvFilename("animals"),
      body: animalsToCSV(animals),
    };
  }

  const pdfBuf = await buildPdf(
    "Animal List",
    ["Animal ID", "Name", "Sex", "Breed", "Category", "Camp", "Status", "Date of Birth", "Date Added"],
    animals.map((a) => [a.animalId, a.name, a.sex, a.breed, a.category, a.currentCamp, a.status, a.dateOfBirth, a.dateAdded]),
  );
  return {
    contentType: "application/pdf",
    filename: pdfFilename("animals"),
    body: pdfBuf,
  };
}
