// lib/server/export/transactions.ts
// Financial transactions exporter (CSV/PDF).

import { transactionsToCSV, type TransactionRow } from "@/lib/server/export-csv";
import type { ExportArtifact, ExportContext } from "./types";
import { buildPdf, csvFilename, pdfFilename } from "./pdf";

export async function exportTransactions(ctx: ExportContext): Promise<ExportArtifact> {
  const where: Record<string, unknown> = {};
  if (ctx.from || ctx.to) {
    const dateFilter: Record<string, string> = {};
    if (ctx.from) dateFilter.gte = `${ctx.from}-01`;
    if (ctx.to) dateFilter.lte = `${ctx.to}-31`;
    where.date = dateFilter;
  }

  const raw = await ctx.prisma.transaction.findMany({
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

  if (ctx.format === "csv") {
    return {
      contentType: "text/csv",
      filename: csvFilename("transactions"),
      body: transactionsToCSV(transactions),
    };
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
    ]),
  );
  return {
    contentType: "application/pdf",
    filename: pdfFilename("transactions"),
    body: pdfBuf,
  };
}
