import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForFarm } from "@/lib/farm-prisma";
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
  type CampRow,
  type TransactionRow,
} from "@/lib/server/export-csv";
// @ts-ignore
import { jsPDF } from "jspdf";
// @ts-ignore
import { autoTable } from "jspdf-autotable";

export const dynamic = "force-dynamic";

type ExportType = "animals" | "withdrawal" | "calvings" | "camps" | "transactions";
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

    return new Response(JSON.stringify({ error: "Invalid export type" }), { status: 400 });
  } catch (err) {
    console.error("[export] Error generating export:", err);
    return new Response(JSON.stringify({ error: "Export failed" }), { status: 500 });
  }
}
