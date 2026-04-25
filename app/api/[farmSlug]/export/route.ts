// app/api/[farmSlug]/export/route.ts
//
// Thin orchestrator for tenant-scoped exports. Auth + tier gate + rate
// limit + format dispatch live here; the actual per-resource ETL lives
// in `@/lib/server/export/<resource>.ts`.

import { NextRequest } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
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

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const { farmSlug } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
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
    console.error("[export] Error generating export:", err);
    return new Response(JSON.stringify({ error: "Export failed" }), { status: 500 });
  }
}
