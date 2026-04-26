// lib/server/export/animals.ts
// Animal list exporter (CSV/PDF).

import { animalsToCSV } from "@/lib/server/export-csv";
import type { ExportArtifact, ExportContext } from "./types";
import { ExportRequestError } from "./types";
import { buildPdf, csvFilename, pdfFilename } from "./pdf";
import type { SpeciesId } from "@/lib/species/types";

const VALID_SPECIES: readonly SpeciesId[] = ["cattle", "sheep", "game"];

function isValidSpecies(value: string): value is SpeciesId {
  return (VALID_SPECIES as readonly string[]).includes(value);
}

export async function exportAnimals(ctx: ExportContext): Promise<ExportArtifact> {
  // Optional ?species= filter — when present, scope the export to that species
  // so that clicking "Export" from a species-scoped catalogue (e.g. /sheep/animals)
  // delivers only the rows the user can see. When absent, the legacy cross-species
  // behaviour is preserved (e.g. bulk export from a multi-species reports page).
  const speciesParam = ctx.url.searchParams.get("species");

  let speciesFilter: SpeciesId | undefined;
  if (speciesParam !== null) {
    if (!isValidSpecies(speciesParam)) {
      throw new ExportRequestError(
        400,
        `Invalid species "${speciesParam}". Must be one of: ${VALID_SPECIES.join(", ")}.`,
      );
    }
    speciesFilter = speciesParam;
  }

  const animals = await ctx.prisma.animal.findMany({
    where: {
      status: "Active",
      ...(speciesFilter !== undefined ? { species: speciesFilter } : {}),
    },
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
