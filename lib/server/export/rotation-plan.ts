// lib/server/export/rotation-plan.ts
// Single rotation plan exporter (CSV/PDF). Requires `?planId=` query param.

import { rotationPlanToCSV, type RotationPlanExportStep } from "@/lib/server/export-csv";
import type { ExportArtifact, ExportContext } from "./types";
import { ExportRequestError } from "./types";
import { buildPdf, csvFilename, pdfFilename } from "./pdf";

export async function exportRotationPlan(ctx: ExportContext): Promise<ExportArtifact> {
  const planId = ctx.url.searchParams.get("planId");
  if (!planId) {
    throw new ExportRequestError(400, "planId is required for rotation-plan export");
  }

  const plan = await ctx.prisma.rotationPlan.findUnique({
    where: { id: planId },
    include: { steps: { orderBy: { sequence: "asc" } } },
  });
  if (!plan) {
    throw new ExportRequestError(404, "Plan not found");
  }

  // Build camp and mob lookup maps
  const campIds = [...new Set(plan.steps.map((s) => s.campId))];
  const mobIds = [...new Set(plan.steps.map((s) => s.mobId).filter(Boolean))] as string[];

  const [camps, mobs] = await Promise.all([
    campIds.length > 0
      ? ctx.prisma.camp.findMany({ where: { campId: { in: campIds } }, select: { campId: true, campName: true } })
      : [],
    mobIds.length > 0
      ? ctx.prisma.mob.findMany({ where: { id: { in: mobIds } }, select: { id: true, name: true } })
      : [],
  ]);

  const campNameMap = new Map(camps.map((c) => [c.campId, c.campName]));
  const mobNameMap = new Map(mobs.map((m) => [m.id, m.name]));

  const exportSteps: RotationPlanExportStep[] = plan.steps.map((s) => ({
    sequence: s.sequence,
    campName: campNameMap.get(s.campId) ?? s.campId,
    mobName: s.mobId ? (mobNameMap.get(s.mobId) ?? null) : null,
    plannedStart: s.plannedStart.toISOString(),
    plannedDays: s.plannedDays,
    status: s.status,
    actualStart: s.actualStart?.toISOString() ?? null,
    notes: s.notes,
  }));

  const filenameStem = `rotation-plan-${plan.name.replace(/\s+/g, "-").toLowerCase()}`;

  if (ctx.format === "csv") {
    return {
      contentType: "text/csv",
      filename: csvFilename(filenameStem),
      body: rotationPlanToCSV(plan.name, exportSteps),
    };
  }

  const pdfBuf = await buildPdf(
    `Rotation Plan: ${plan.name}`,
    ["#", "Camp", "Mob", "Planned Start", "Days", "Status", "Actual Start", "Notes"],
    exportSteps.map((s) => [
      s.sequence,
      s.campName,
      s.mobName,
      s.plannedStart.slice(0, 10),
      s.plannedDays,
      s.status,
      s.actualStart ? s.actualStart.slice(0, 10) : null,
      s.notes,
    ]),
  );
  return {
    contentType: "application/pdf",
    filename: pdfFilename(filenameStem),
    body: pdfBuf,
  };
}
