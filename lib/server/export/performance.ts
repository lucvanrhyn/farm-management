// lib/server/export/performance.ts
// Camp performance exporter (CSV/PDF). Aggregates animal counts via a
// single groupBy, derives per-camp LSU using merged-LSU values, and pairs
// the latest cover reading with daysGrazingRemaining when both are
// available.

import { calcDaysGrazingRemaining } from "@/lib/server/analytics";
import { getMergedLsuValues } from "@/lib/species/registry";
import { performanceToCSV, type PerformanceRow } from "@/lib/server/export-csv";
import type { ExportArtifact, ExportContext } from "./types";
import { buildPdf, csvFilename, pdfFilename } from "./pdf";

export async function exportPerformance(ctx: ExportContext): Promise<ExportArtifact> {
  const camps = await ctx.prisma.camp.findMany();
  // cross-species by design: performance export uses merged-LSU values.
  const animalsByCamp = await ctx.prisma.animal.groupBy({
    by: ["currentCamp", "category"],
    where: { status: "Active" },
    _count: { id: true },
  });

  const coverReadings = await ctx.prisma.campCoverReading.findMany({
    orderBy: { recordedAt: "desc" },
  });

  // Latest cover per camp
  const latestCover = new Map<string, { kgDmPerHa: number | null }>();
  for (const r of coverReadings) {
    if (!latestCover.has(r.campId)) {
      latestCover.set(r.campId, { kgDmPerHa: r.kgDmPerHa ?? null });
    }
  }

  // Derive total count per camp from the category groupBy (no second query needed)
  const countMap = new Map<string, number>();
  for (const row of animalsByCamp) {
    countMap.set(row.currentCamp, (countMap.get(row.currentCamp) ?? 0) + row._count.id);
  }

  const lsuMap = getMergedLsuValues();

  const rows: PerformanceRow[] = camps.map((c) => {
    const cover = latestCover.get(c.campId);
    const campAnimals = animalsByCamp
      .filter((a) => a.currentCamp === c.campId)
      .map((a) => ({ category: a.category, count: a._count.id }));

    const dgr = cover?.kgDmPerHa != null && c.sizeHectares
      ? calcDaysGrazingRemaining(cover.kgDmPerHa, 0.35, c.sizeHectares, campAnimals)
      : null;

    const totalLsu = campAnimals.reduce((sum, a) => {
      return sum + a.count * (lsuMap[a.category] ?? 1.0);
    }, 0);

    return {
      campId: c.campId,
      campName: c.campName,
      sizeHectares: c.sizeHectares ?? null,
      animalCount: countMap.get(c.campId) ?? 0,
      lsuPerHa: c.sizeHectares && c.sizeHectares > 0 ? totalLsu / c.sizeHectares : null,
      kgDmPerHa: cover?.kgDmPerHa ?? null,
      daysGrazingRemaining: dgr,
    };
  });

  if (ctx.format === "csv") {
    return {
      contentType: "text/csv",
      filename: csvFilename("performance"),
      body: performanceToCSV(rows),
    };
  }

  const pdfBuf = await buildPdf(
    "Camp Performance Summary",
    ["Camp ID", "Camp Name", "Size (ha)", "Animals", "LSU/ha", "kg DM/ha", "Days Grazing Remaining"],
    rows.map((r) => [
      r.campId,
      r.campName,
      r.sizeHectares,
      r.animalCount,
      r.lsuPerHa != null ? r.lsuPerHa.toFixed(2) : null,
      r.kgDmPerHa,
      r.daysGrazingRemaining,
    ]),
  );
  return {
    contentType: "application/pdf",
    filename: pdfFilename("performance"),
    body: pdfBuf,
  };
}
