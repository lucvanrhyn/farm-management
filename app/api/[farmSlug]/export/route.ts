import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type { SessionFarm } from "@/types/next-auth";
import { getAnimalsInWithdrawal } from "@/lib/server/treatment-analytics";
import { getReproStats } from "@/lib/server/reproduction-analytics";
import { getLatestCampConditions } from "@/lib/server/camp-status";
import {
  animalsToCSV,
  withdrawalToCSV,
  calvingsToCSV,
  campsToCSV,
  transactionsToCSV,
  weightHistoryToCSV,
  reproSummaryToCSV,
  performanceToCSV,
  rotationPlanToCSV,
  cogByCampToCSV,
  cogByAnimalToCSV,
  veldScoreToCSV,
  type CampRow,
  type TransactionRow,
  type WeightHistoryRow,
  type ReproSummaryRow,
  type PerformanceRow,
  type RotationPlanExportStep,
  type VeldScoreRow,
} from "@/lib/server/export-csv";
import { getFarmSummary as getVeldFarmSummary } from "@/lib/server/veld-score";
import { getCogByCamp, getCogByAnimal } from "@/lib/server/financial-analytics";
import { isCogScope } from "@/lib/calculators/cost-of-gain";
import { calcDaysGrazingRemaining } from "@/lib/server/analytics";
import { getMergedLsuValues } from "@/lib/species/registry";
// @ts-ignore
import { jsPDF } from "jspdf";
// @ts-ignore
import { autoTable } from "jspdf-autotable";

export const dynamic = "force-dynamic";

type ExportType = "animals" | "withdrawal" | "calvings" | "camps" | "transactions" | "weight-history" | "reproduction" | "performance" | "rotation-plan" | "cost-of-gain" | "veld-score";
type ExportFormat = "csv" | "pdf";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function pdfFilename(type: string): string {
  return `${type}-${today()}.pdf`;
}

function csvFilename(type: string): string {
  return `${type}-${today()}.csv`;
}

async function buildPdf(
  title: string,
  head: string[],
  body: (string | number | null | undefined)[][]
): Promise<ArrayBuffer> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  doc.setFontSize(9);
  doc.text(`Generated: ${new Date().toLocaleDateString("en-ZA")}`, 14, 22);
  autoTable(doc, {
    head: [head],
    body: body.map((r) => r.map((cell) => (cell === null || cell === undefined ? "" : String(cell)))),
    startY: 27,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 246, 243] },
  });
  return doc.output("arraybuffer") as ArrayBuffer;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ farmSlug: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { farmSlug } = await params;

  const accessible = (session.user?.farms as SessionFarm[] | undefined)?.some(
    (f) => f.slug === farmSlug
  );
  if (!accessible) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  // Rate limit: 20 exports per 10 minutes per farm (PDF generation is CPU-intensive)
  const rl = checkRateLimit(`export:${farmSlug}`, 20, 10 * 60 * 1000);
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Too many export requests. Please wait." }), { status: 429 });
  }

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    return new Response(JSON.stringify({ error: "Farm not found" }), { status: 404 });
  }

  const url = new URL(req.url);
  const type = (url.searchParams.get("type") ?? "animals") as ExportType;
  const format = (url.searchParams.get("format") ?? "csv") as ExportFormat;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  try {
    if (type === "animals") {
      const animals = await prisma.animal.findMany({
        where: { status: "Active" },
        orderBy: { animalId: "asc" },
      });

      if (format === "csv") {
        const csv = animalsToCSV(animals);
        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="${csvFilename("animals")}"`,
          },
        });
      }

      const pdfBuf = await buildPdf(
        "Animal List",
        ["Animal ID", "Name", "Sex", "Breed", "Category", "Camp", "Status", "Date of Birth", "Date Added"],
        animals.map((a) => [a.animalId, a.name, a.sex, a.breed, a.category, a.currentCamp, a.status, a.dateOfBirth, a.dateAdded])
      );
      return new Response(pdfBuf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdfFilename("animals")}"`,
        },
      });
    }

    if (type === "withdrawal") {
      const animals = await getAnimalsInWithdrawal(prisma);

      if (format === "csv") {
        const csv = withdrawalToCSV(animals);
        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="${csvFilename("withdrawal")}"`,
          },
        });
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
        ])
      );
      return new Response(pdfBuf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdfFilename("withdrawal")}"`,
        },
      });
    }

    if (type === "calvings") {
      const stats = await getReproStats(prisma);
      const calvings = stats.upcomingCalvings;

      if (format === "csv") {
        const csv = calvingsToCSV(calvings);
        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="${csvFilename("calvings")}"`,
          },
        });
      }

      function urgencyLabel(daysAway: number): string {
        if (daysAway < 0) return "Overdue";
        if (daysAway <= 7) return "Due in 7 days";
        if (daysAway <= 14) return "Due in 14 days";
        return "Upcoming";
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
        ])
      );
      return new Response(pdfBuf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdfFilename("calvings")}"`,
        },
      });
    }

    if (type === "camps") {
      const [rawCamps, conditionMap] = await Promise.all([
        prisma.camp.findMany(),
        getLatestCampConditions(prisma),
      ]);

      const campRows: CampRow[] = rawCamps.map((c) => {
        const cond = conditionMap.get(c.campId);
        return {
          campId: c.campId,
          campName: c.campName,
          sizeHectares: c.sizeHectares ?? null,
          waterSource: c.waterSource ?? null,
          grazingQuality: cond?.grazing_quality ?? null,
          waterStatus: cond?.water_status ?? null,
          fenceStatus: cond?.fence_status ?? null,
          lastInspectedAt: cond?.last_inspected_at ?? null,
        };
      });

      if (format === "csv") {
        const csv = campsToCSV(campRows);
        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="${csvFilename("camps")}"`,
          },
        });
      }

      const pdfBuf = await buildPdf(
        "Camp Summary",
        ["Camp ID", "Camp Name", "Size (ha)", "Water Source", "Grazing Quality", "Water Status", "Fence Status", "Last Inspected"],
        campRows.map((c) => [
          c.campId,
          c.campName,
          c.sizeHectares,
          c.waterSource,
          c.grazingQuality,
          c.waterStatus,
          c.fenceStatus,
          c.lastInspectedAt,
        ])
      );
      return new Response(pdfBuf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdfFilename("camps")}"`,
        },
      });
    }

    if (type === "transactions") {
      const where: Record<string, unknown> = {};
      if (from || to) {
        const dateFilter: Record<string, string> = {};
        if (from) dateFilter.gte = `${from}-01`;
        if (to) dateFilter.lte = `${to}-31`;
        where.date = dateFilter;
      }

      const raw = await prisma.transaction.findMany({
        where,
        orderBy: { date: "desc" },
      });

      const transactions: TransactionRow[] = raw.map((t) => ({
        date: t.date,
        type: t.type,
        category: t.category,
        amount: t.amount,
        description: t.description,
        animalId: t.animalId ?? null,
        saleType: t.saleType ?? null,
        counterparty: t.counterparty ?? null,
        quantity: t.quantity ?? null,
        avgMassKg: t.avgMassKg ?? null,
        fees: t.fees ?? null,
        transportCost: t.transportCost ?? null,
      }));

      if (format === "csv") {
        const csv = transactionsToCSV(transactions);
        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="${csvFilename("transactions")}"`,
          },
        });
      }

      const pdfBuf = await buildPdf(
        "Financial Transactions",
        ["Date", "Type", "Category", "Amount (R)", "Description", "Animal ID", "Sale Type", "Buyer/Seller", "Qty", "Avg Mass", "Fees", "Transport"],
        transactions.map((t) => [
          t.date,
          t.type,
          t.category,
          t.amount,
          t.description,
          t.animalId,
          t.saleType,
          t.counterparty,
          t.quantity,
          t.avgMassKg,
          t.fees,
          t.transportCost,
        ])
      );
      return new Response(pdfBuf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdfFilename("transactions")}"`,
        },
      });
    }

    if (type === "weight-history") {
      const weighingWhere: Record<string, unknown> = { type: "weighing" };
      if (from || to) {
        const dateFilter: Record<string, Date> = {};
        if (from) dateFilter.gte = new Date(from);
        if (to) dateFilter.lte = new Date(to);
        weighingWhere.observedAt = dateFilter;
      }
      const obs = await prisma.observation.findMany({
        where: weighingWhere,
        orderBy: { observedAt: "desc" },
        select: { animalId: true, observedAt: true, details: true },
      });

      // Build a map of animalId → name + camp for enrichment
      const animalIds = [...new Set(obs.map((o) => o.animalId).filter(Boolean))] as string[];
      const animals = animalIds.length > 0
        ? await prisma.animal.findMany({
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

      if (format === "csv") {
        const csv = weightHistoryToCSV(rows);
        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="${csvFilename("weight-history")}"`,
          },
        });
      }

      const pdfBuf = await buildPdf(
        "Weight History",
        ["Animal ID", "Name", "Camp", "Date", "Weight (kg)"],
        rows.map((r) => [r.animalId, r.name, r.camp, r.date, r.weightKg])
      );
      return new Response(pdfBuf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdfFilename("weight-history")}"`,
        },
      });
    }

    if (type === "reproduction") {
      const stats = await getReproStats(prisma);

      const rows: ReproSummaryRow[] = [
        {
          metric: "Pregnancy Rate",
          value: stats.pregnancyRate != null ? `${stats.pregnancyRate.toFixed(1)}%` : "N/A",
          benchmark: "≥85%",
        },
        {
          metric: "Calving Rate",
          value: stats.calvingRate != null ? `${stats.calvingRate.toFixed(1)}%` : "N/A",
          benchmark: "≥85%",
        },
        {
          metric: "Avg Calving Interval",
          value: stats.avgCalvingIntervalDays != null ? `${Math.round(stats.avgCalvingIntervalDays)} days` : "N/A",
          benchmark: "≤365 days",
        },
        {
          metric: "Upcoming Calvings (next 90d)",
          value: String(stats.upcomingCalvings.length),
          benchmark: "—",
        },
        {
          metric: "In Heat (7d)",
          value: String(stats.inHeat7d),
          benchmark: "—",
        },
      ];

      if (format === "csv") {
        const csv = reproSummaryToCSV(rows);
        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="${csvFilename("reproduction")}"`,
          },
        });
      }

      const pdfBuf = await buildPdf(
        "Reproduction Summary",
        ["Metric", "Value", "SA Benchmark"],
        rows.map((r) => [r.metric, r.value, r.benchmark])
      );
      return new Response(pdfBuf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdfFilename("reproduction")}"`,
        },
      });
    }

    if (type === "performance") {
      const camps = await prisma.camp.findMany();
      const animalsByCamp = await prisma.animal.groupBy({
        by: ["currentCamp", "category"],
        where: { status: "Active" },
        _count: { id: true },
      });

      const coverReadings = await prisma.campCoverReading.findMany({
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

      if (format === "csv") {
        const csv = performanceToCSV(rows);
        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="${csvFilename("performance")}"`,
          },
        });
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
        ])
      );
      return new Response(pdfBuf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdfFilename("performance")}"`,
        },
      });
    }

    if (type === "rotation-plan") {
      const planId = url.searchParams.get("planId");
      if (!planId) {
        return new Response(JSON.stringify({ error: "planId is required for rotation-plan export" }), { status: 400 });
      }

      const plan = await prisma.rotationPlan.findUnique({
        where: { id: planId },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
      if (!plan) {
        return new Response(JSON.stringify({ error: "Plan not found" }), { status: 404 });
      }

      // Build camp and mob lookup maps
      const campIds = [...new Set(plan.steps.map((s) => s.campId))];
      const mobIds = [...new Set(plan.steps.map((s) => s.mobId).filter(Boolean))] as string[];

      const [camps, mobs] = await Promise.all([
        campIds.length > 0 ? prisma.camp.findMany({ where: { campId: { in: campIds } }, select: { campId: true, campName: true } }) : [],
        mobIds.length > 0 ? prisma.mob.findMany({ where: { id: { in: mobIds } }, select: { id: true, name: true } }) : [],
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

      if (format === "csv") {
        const csv = rotationPlanToCSV(plan.name, exportSteps);
        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="${csvFilename(`rotation-plan-${plan.name.replace(/\s+/g, "-").toLowerCase()}`)}"`,
          },
        });
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
        ])
      );
      return new Response(pdfBuf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdfFilename(`rotation-plan-${plan.name.replace(/\s+/g, "-").toLowerCase()}`)}"`,
        },
      });
    }

    if (type === "cost-of-gain") {
      const view = url.searchParams.get("view") ?? "camp";
      const scopeRaw = url.searchParams.get("scope");
      const scope = isCogScope(scopeRaw) ? scopeRaw : "all";

      const now = new Date();
      const defaultFrom = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : defaultFrom;
      const toDate = to ? new Date(`${to}T23:59:59.999Z`) : now;

      if (view === "animal") {
        const rows = await getCogByAnimal(prisma, fromDate, toDate, scope, 500);
        if (format === "csv") {
          return new Response(cogByAnimalToCSV(rows), {
            headers: {
              "Content-Type": "text/csv",
              "Content-Disposition": `attachment; filename="${csvFilename(`cost-of-gain-by-animal-${scope}`)}"`,
            },
          });
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
        return new Response(pdfBuf, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${pdfFilename(`cost-of-gain-by-animal-${scope}`)}"`,
          },
        });
      }

      const rows = await getCogByCamp(prisma, fromDate, toDate, scope);
      if (format === "csv") {
        return new Response(cogByCampToCSV(rows), {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="${csvFilename(`cost-of-gain-by-camp-${scope}`)}"`,
          },
        });
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
      return new Response(pdfBuf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdfFilename(`cost-of-gain-by-camp-${scope}`)}"`,
        },
      });
    }

    if (type === "veld-score") {
      const summary = await getVeldFarmSummary(prisma);
      const rows: VeldScoreRow[] = summary.byCamp.map((c) => ({
        campId: c.campId,
        latestDate: c.latestDate,
        assessor: c.assessor,
        veldScore: c.latestScore,
        haPerLsu: c.haPerLsu,
        trendSlope: c.trendSlope,
        daysSinceAssessment: c.daysSinceAssessment,
      }));

      if (format === "csv") {
        const csv = veldScoreToCSV(rows);
        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="${csvFilename("veld-score")}"`,
          },
        });
      }

      const pdfBuf = await buildPdf(
        "Farm Veld Condition Summary",
        ["Camp", "Latest Date", "Assessor", "Score", "ha/LSU", "Trend/mo", "Days Since"],
        rows.map((r) => [
          r.campId,
          r.latestDate,
          r.assessor,
          r.veldScore,
          r.haPerLsu != null ? r.haPerLsu.toFixed(2) : null,
          r.trendSlope.toFixed(3),
          r.daysSinceAssessment,
        ]),
      );
      return new Response(pdfBuf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdfFilename("veld-score")}"`,
        },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid export type" }), { status: 400 });
  } catch (err) {
    console.error("[export] Error generating export:", err);
    return new Response(JSON.stringify({ error: "Export failed" }), { status: 500 });
  }
}
