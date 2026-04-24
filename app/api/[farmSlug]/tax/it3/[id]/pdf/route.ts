/**
 * GET /api/[farmSlug]/tax/it3/[id]/pdf — re-render PDF from stored snapshot
 */
import { NextRequest } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
import { buildIt3Pdf } from "@/lib/server/sars-it3-pdf";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string; id: string }> },
) {
  const { farmSlug, id } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const record = await ctx.prisma.it3Snapshot.findUnique({ where: { id } });
  if (!record) {
    return new Response(JSON.stringify({ error: "IT3 snapshot not found" }), { status: 404 });
  }

  const pdf = buildIt3Pdf({
    taxYear: record.taxYear,
    issuedAt: record.issuedAt,
    payload: record.payload,
    generatedBy: record.generatedBy,
    pdfHash: record.pdfHash,
    voidedAt: record.voidedAt,
    voidReason: record.voidReason,
  });

  const filename = `sars-it3-${record.taxYear}.pdf`;

  return new Response(pdf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
