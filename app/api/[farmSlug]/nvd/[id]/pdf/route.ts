/**
 * GET /api/[farmSlug]/nvd/[id]/pdf — re-render PDF from stored snapshot
 *
 * Wave G1 (#165) — migrated onto `tenantReadSlug`. The handler returns a
 * raw `Response` carrying `Content-Type: application/pdf` plus the
 * canonical `Content-Disposition` filename; `tenantReadSlug` passes the
 * binary `Response` through unchanged (NEVER wraps in a JSON envelope).
 *
 * Not-found path wires into `mapApiDomainError` via `renderNvdPdf` →
 * `NvdNotFoundError` → 404 `{ error: "NVD_NOT_FOUND" }`.
 */
import { tenantReadSlug } from "@/lib/server/route";
import { renderNvdPdf } from "@/lib/domain/nvd";

export const dynamic = "force-dynamic";

export const GET = tenantReadSlug<{ farmSlug: string; id: string }>({
  handle: async (ctx, _req, params) => {
    const { pdf, filename } = await renderNvdPdf(ctx.prisma, params.id);

    return new Response(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  },
});
