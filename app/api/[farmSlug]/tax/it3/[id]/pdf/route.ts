/**
 * GET /api/[farmSlug]/tax/it3/[id]/pdf — re-render PDF from stored snapshot
 *
 * Wave G8 (#172) — migrated onto `tenantReadSlug`. Final feature wave of the
 * ADR-0001 7/8 rollout.
 *
 * Wire-shape preservation:
 *   - 200 success returns a raw `Response` with `application/pdf` body and the
 *     legacy `Content-Disposition: attachment; filename="..."` header verbatim.
 *     The adapter (see `lib/server/route/tenant-read-slug.ts:18-22`) explicitly
 *     supports raw `Response` returns from `handle` — adapter only mints JSON
 *     envelopes on the error path, so the binary body flows through untouched.
 *   - 401 envelope migrates to the adapter's canonical `AUTH_REQUIRED` typed
 *     envelope. The legacy `new Response(JSON.stringify({error:"Unauthorized"}))`
 *     branch is gone — the adapter now centralises that path.
 *   - S26 (ADR-0001 sweep) — 404 converges on the canonical typed envelope
 *     `{ error: "NOT_FOUND", message: "IT3 snapshot not found" }` via
 *     `routeError` (status unchanged; `Content-Type: application/json`).
 */
import { tenantReadSlug } from "@/lib/server/route";
import { routeError } from "@/lib/server/route/envelope";

import { buildIt3Pdf } from "@/lib/server/sars-it3-pdf";

export const dynamic = "force-dynamic";

export const GET = tenantReadSlug<{ farmSlug: string; id: string }>({
  handle: async (ctx, _req, { id }) => {
    const record = await ctx.prisma.it3Snapshot.findUnique({ where: { id } });
    if (!record) {
      return routeError("NOT_FOUND", "IT3 snapshot not found", 404);
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
  },
});
