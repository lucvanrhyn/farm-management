// app/api/[farmSlug]/export/route.ts
//
// Thin orchestrator for tenant-scoped exports. Auth + tier gate + rate
// limit + format dispatch live here; the actual per-resource ETL lives
// in `@/lib/server/export/<resource>.ts`.
//
// Wave G7 (#171) — migrated onto `tenantReadSlug`.
//
// Wire-shape preservation (hybrid per ADR-0001 / Wave G7 spec):
//   - 401 envelope migrates to the adapter's canonical
//     `{ error: "AUTH_REQUIRED", message: "Unauthorized" }` (NextResponse.json).
//   - All other branches keep their bare-string `{ error }` JSON envelope on
//     a raw `Response` (legacy wire-shape; tier gate, rate limit, invalid
//     type, ExportRequestError, generic 500).
//   - 2xx success returns a raw `Response` with the binary body and
//     `Content-Type` / `Content-Disposition` headers — the adapter passes
//     this through unchanged (see lib/server/route/tenant-read-slug.ts:18-22).

import { tenantReadSlug } from "@/lib/server/route";
import { getFarmCreds } from "@/lib/meta-db";
import { checkRateLimit } from "@/lib/rate-limit";
import { isPaidTier } from "@/lib/tier";
import {
  ADVANCED_ONLY_EXPORTS,
  ExportRequestError,
  dispatchExport,
  isExportType,
  type ExportContext,
  type ExportFormat,
  type ExportType,
} from "@/lib/server/export";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (ctx, req, { farmSlug }) => {
    const prisma = ctx.prisma;

    // Rate limit: 20 exports per 10 minutes per farm (PDF generation is CPU-intensive)
    const rl = checkRateLimit(`export:${farmSlug}`, 20, 10 * 60 * 1000);
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: "Too many export requests. Please wait." }), { status: 429 });
    }

    const url = new URL(req.url);
    const typeParam = url.searchParams.get("type") ?? "animals";
    if (!isExportType(typeParam)) {
      return new Response(JSON.stringify({ error: "Invalid export type" }), { status: 400 });
    }
    const type: ExportType = typeParam;

    // Tier check for advanced-only exports (Consulting also allowed — Phase L tier extension)
    if (ADVANCED_ONLY_EXPORTS.has(type)) {
      const creds = await getFarmCreds(farmSlug);
      if (!creds || !isPaidTier(creds.tier)) {
        return new Response(JSON.stringify({ error: "This export requires an Advanced subscription." }), { status: 403 });
      }
    }

    const format = (url.searchParams.get("format") ?? "csv") as ExportFormat;
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    const exportCtx: ExportContext = { prisma, format, url, from, to };

    try {
      const { contentType, filename, body } = await dispatchExport(type, exportCtx);
      return new Response(body, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    } catch (err) {
      if (err instanceof ExportRequestError) {
        return new Response(JSON.stringify({ error: err.message }), { status: err.status });
      }
      logger.error('[export] Error generating export', err);
      return new Response(JSON.stringify({ error: "Export failed" }), { status: 500 });
    }
  },
});
