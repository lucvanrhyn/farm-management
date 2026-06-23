// lib/server/export/weight-history.ts
// Animal weight history exporter (CSV/PDF). Joins weighings to animals
// for tag/name/camp enrichment.

import { weightHistoryToCSV, type WeightHistoryRow } from "@/lib/server/export-csv";
import type { ExportArtifact, ExportContext } from "./types";
import { buildPdf, csvFilename, pdfFilename } from "./pdf";
import { crossSpecies } from "@/lib/server/species-scoped-prisma";
import { parseWeighingMassKg } from "@/lib/domain/observations/weighing-mass";

export async function exportWeightHistory(ctx: ExportContext): Promise<ExportArtifact> {
  const weighingWhere: Record<string, unknown> = { type: "weighing" };
  if (ctx.from || ctx.to) {
    const dateFilter: Record<string, Date> = {};
    if (ctx.from) dateFilter.gte = new Date(ctx.from);
    if (ctx.to) dateFilter.lte = new Date(ctx.to);
    weighingWhere.observedAt = dateFilter;
  }
  // Farm-wide weight-history export — crossSpecies() forwards the
  // existing date/id predicates verbatim (no species/status injection).
  const xs = crossSpecies(ctx.prisma, "farm-wide-audit");
  const obs = await xs.observation.findMany({
    where: weighingWhere,
    orderBy: { observedAt: "desc" },
    select: { animalId: true, observedAt: true, details: true },
  });

  // Build a map of tag → name + camp for enrichment. Observation.animalId
  // stores the animal TAG (Animal.animalId @unique), NOT the cuid Animal.id —
  // so enrich by matching tag→tag, else every Name/Camp column comes back blank
  // (see gotcha-observation-animalid-is-tag-not-cuid).
  const animalTags = [...new Set(obs.map((o) => o.animalId).filter(Boolean))] as string[];
  const animals = animalTags.length > 0
    ? await xs.animal.findMany({
        where: { animalId: { in: animalTags } },
        select: { animalId: true, name: true, currentCamp: true },
      })
    : [];
  const animalMap = new Map(animals.map((a) => [a.animalId, a]));

  const rows: WeightHistoryRow[] = obs
    .map((o) => {
      const animal = o.animalId ? animalMap.get(o.animalId) : undefined;
      const weightKg = parseWeighingMassKg(o.details) ?? 0;
      if (!weightKg) return null;
      return {
        animalId: animal?.animalId ?? o.animalId ?? "",
        name: animal?.name ?? null,
        camp: animal?.currentCamp ?? null,
        date: o.observedAt.toISOString().slice(0, 10),
        weightKg,
      };
    })
    .filter((r): r is WeightHistoryRow => r !== null);

  if (ctx.format === "csv") {
    return {
      contentType: "text/csv",
      filename: csvFilename("weight-history"),
      body: weightHistoryToCSV(rows),
    };
  }

  const pdfBuf = await buildPdf(
    "Weight History",
    ["Animal ID", "Name", "Camp", "Date", "Weight (kg)"],
    rows.map((r) => [r.animalId, r.name, r.camp, r.date, r.weightKg]),
  );
  return {
    contentType: "application/pdf",
    filename: pdfFilename("weight-history"),
    body: pdfBuf,
  };
}
