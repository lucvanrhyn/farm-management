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
//   - S26 (ADR-0001 sweep) — all error branches converge on the canonical
//     typed envelope `{ error: CODE, message }` via `routeError`: 429 rate
//     limit → RATE_LIMITED, 400 invalid type → VALIDATION_FAILED, 403 tier gate
//     → FORBIDDEN, ExportRequestError → EXPORT_REQUEST_INVALID, generic 500 →
//     EXPORT_FAILED. Statuses unchanged. The export cards only act on `res.ok`,
//     so moving the sentence to `message` is wire-safe.
//   - 2xx success returns a raw `Response` with the binary body and
//     `Content-Type` / `Content-Disposition` headers — the adapter passes
//     this through unchanged (see lib/server/route/tenant-read-slug.ts:18-22).

import { tenantReadSlug } from "@/lib/server/route";
import { routeError } from "@/lib/server/route/envelope";
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
      return routeError("RATE_LIMITED", "Too many export requests. Please wait.", 429);
    }

    const url = new URL(req.url);
    const typeParam = url.searchParams.get("type") ?? "animals";
    if (!isExportType(typeParam)) {
      return routeError("VALIDATION_FAILED", "Invalid export type");
    }
    const type: ExportType = typeParam;

    // Tier check for advanced-only exports (Consulting also allowed — Phase L tier extension)
    if (ADVANCED_ONLY_EXPORTS.has(type)) {
      const creds = await getFarmCreds(farmSlug);
      if (!creds || !isPaidTier(creds.tier)) {
        return routeError(
          "FORBIDDEN",
          "This export requires an Advanced subscription.",
          403,
        );
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
        // Issue #493 (PRD #479 Epic B) — converge on the canonical typed
        // envelope. The `error` field carries the SCREAMING_SNAKE code
        // `EXPORT_REQUEST_INVALID`; the developer-authored bail-out sentence
        // (e.g. "planId is required for rotation-plan export") moves to the
        // human-readable `message` slot. Previously this echoed `err.message`
        // straight into `error`, which the error-envelope arch-test
        // (`scripts/audit-error-envelope.ts`) flags as a raw-message echo.
        // No client reads this body's `error` field (the export cards only
        // act on `res.ok`), so moving the sentence to `message` is wire-safe.
        return routeError("EXPORT_REQUEST_INVALID", err.message, err.status);
      }
      logger.error('[export] Error generating export', err);
      // S26 ADR-0001 — the generic export failure converges on the canonical
      // typed envelope. The `error` field carries the SCREAMING_SNAKE code
      // `EXPORT_FAILED`; the static "Export failed" sentence (no raw error text
      // — `err` is logged server-side, never echoed) moves to the `message`
      // slot. 500 is EXPORT_FAILED's inferred status (no DEFAULT_STATUS entry).
      return routeError("EXPORT_FAILED", "Export failed", 500);
    }
  },
});
