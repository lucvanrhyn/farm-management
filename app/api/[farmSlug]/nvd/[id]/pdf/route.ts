/**
 * GET /api/[farmSlug]/nvd/[id]/pdf — re-render PDF from stored snapshot
 */
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import type { SessionFarm } from "@/types/next-auth";
import { buildNvdPdf } from "@/lib/server/nvd-pdf";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string; id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { farmSlug, id } = await params;

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

  const record = await prisma.nvdRecord.findUnique({ where: { id } });
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
