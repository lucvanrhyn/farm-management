// lib/server/export/weight-history.ts
// Animal weight history exporter (CSV/PDF). Joins weighings to animals
// for tag/name/camp enrichment.

import { weightHistoryToCSV, type WeightHistoryRow } from "@/lib/server/export-csv";
import type { ExportArtifact, ExportContext } from "./types";
import { buildPdf, csvFilename, pdfFilename } from "./pdf";

export async function exportWeightHistory(ctx: ExportContext): Promise<ExportArtifact> {
  const weighingWhere: Record<string, unknown> = { type: "weighing" };
  if (ctx.from || ctx.to) {
    const dateFilter: Record<string, Date> = {};
    if (ctx.from) dateFilter.gte = new Date(ctx.from);
    if (ctx.to) dateFilter.lte = new Date(ctx.to);
    weighingWhere.observedAt = dateFilter;
  }
  const obs = await ctx.prisma.observation.findMany({
    where: weighingWhere,
    orderBy: { observedAt: "desc" },
    select: { animalId: true, observedAt: true, details: true },
  });

  // Build a map of animalId → name + camp for enrichment
  const animalIds = [...new Set(obs.map((o) => o.animalId).filter(Boolean))] as string[];
  // cross-species by design: weight-history rows are looked up by id only.
  const animals = animalIds.length > 0
    ? await ctx.prisma.animal.findMany({
        where: { id: { in: animalIds } },
        select: { id: true, animalId: true, name: true, currentCamp: true },
      })
    : [];
  const animalMap = new Map(animals.map((a) => [a.id, a]));

  const rows: WeightHistoryRow[] = obs
    .map((o) => {
      const animal = o.animalId ? animalMap.get(o.animalId) : undefined;
      let weightKg = 0;
      try {
        const d = JSON.parse(o.details);
        weightKg = Number(d.weight_kg ?? d.weightKg ?? 0);
      } catch { /* skip */ }
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
