/**
 * GET /api/[farmSlug]/nvd/[id]/pdf — re-render PDF from stored snapshot
 */
import { NextRequest } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
import { buildNvdPdf } from "@/lib/server/nvd-pdf";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string; id: string }> }
) {
  const { farmSlug, id } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const record = await ctx.prisma.nvdRecord.findUnique({ where: { id } });
  if (!record) {
    return new Response(JSON.stringify({ error: "NVD not found" }), { status: 404 });
  }

  const pdf = buildNvdPdf({
    nvdNumber: record.nvdNumber,
    issuedAt: record.issuedAt,
    saleDate: record.saleDate,
    buyerName: record.buyerName,
    buyerAddress: record.buyerAddress,
    buyerContact: record.buyerContact,
    destinationAddress: record.destinationAddress,
    sellerSnapshot: record.sellerSnapshot,
    animalSnapshot: record.animalSnapshot,
    declarationsJson: record.declarationsJson,
    generatedBy: record.generatedBy,
    pdfHash: record.pdfHash,
  });

  const filename = `${record.nvdNumber}.pdf`;

  return new Response(pdf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
