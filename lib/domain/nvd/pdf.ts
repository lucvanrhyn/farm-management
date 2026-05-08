/**
 * Wave G1 (#165) — domain helper `renderNvdPdf`.
 *
 * Thin wrapper around `buildNvdPdf` (which still lives in
 * `lib/server/nvd-pdf.ts` because it has heavy jsPDF imports). Returns
 * the rendered PDF bytes plus the canonical filename so the adapter
 * route can mint the binary `Response` shape directly.
 *
 * Wire shape preserved verbatim — `Content-Type: application/pdf` plus
 * `Content-Disposition: attachment; filename="<NVD-NUMBER>.pdf"`. The
 * `tenantReadSlug` adapter passes the binary Response through unchanged.
 */
import { buildNvdPdf } from "@/lib/server/nvd-pdf";

import { getNvdByIdOrThrow } from "./get";

import type { PrismaClient } from "@prisma/client";

export interface RenderedNvdPdf {
  /** Raw PDF bytes. `buildNvdPdf` returns the jsPDF `arraybuffer` output;
   * `Response` accepts `ArrayBuffer` directly via the `BodyInit` union. */
  pdf: ArrayBuffer;
  filename: string;
}

/**
 * Loads the NvdRecord by id (throws `NvdNotFoundError` on miss) and
 * renders its frozen snapshot into a PDF. Returns the bytes + filename
 * the route then plumbs into `new Response(pdf, { headers })`.
 */
export async function renderNvdPdf(
  prisma: PrismaClient,
  id: string,
): Promise<RenderedNvdPdf> {
  const record = await getNvdByIdOrThrow(prisma, id);

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

  return {
    pdf,
    filename: `${record.nvdNumber}.pdf`,
  };
}
