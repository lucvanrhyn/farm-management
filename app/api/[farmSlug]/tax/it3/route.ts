/**
 * GET  /api/[farmSlug]/tax/it3  — paginated list of issued IT3 snapshots
 * POST /api/[farmSlug]/tax/it3  — issue a new snapshot (ADMIN only, rate limited)
 *
 * Wave G8 (#172) — migrated onto `tenantReadSlug` / `tenantWriteSlug`. Final
 * feature wave of the ADR-0001 7/8 rollout.
 *
 * Wire-shape preservation (hybrid per ADR-0001 / Wave G8 spec):
 *   - 200/201 success shapes unchanged.
 *   - 401 envelope migrates to the adapter's canonical
 *     `{ error: "AUTH_REQUIRED", message: "Unauthorized" }`. Legacy bare-string
 *     `{ error: "Unauthorized" }` is gone — every IT3 client tolerates either
 *     because adapters are now the source of truth (G3 precedent).
 *   - 400 INVALID_BODY on malformed JSON now flows through the adapter's typed
 *     envelope (matches G5-G7 precedent). All other handler-minted error
 *     bodies keep their bare-string `{ error: "<sentence>" }` shape so the
 *     IT3 UI form's `body.error` toast renders the human-readable message
 *     verbatim (rate-limit, tier-gate, taxYear range, issueIt3Snapshot throw).
 *   - 403 (Forbidden / tier-gate), 422 (issueIt3Snapshot throw),
 *     429 (rate-limit), 400 (taxYear range) preserved verbatim.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug, tenantWriteSlug } from "@/lib/server/route";
import { verifyFreshAdminRole } from "@/lib/auth";
import { getFarmCreds } from "@/lib/meta-db";
import { checkRateLimit } from "@/lib/rate-limit";
import { issueIt3Snapshot } from "@/lib/server/sars-it3";
import { isPaidTier } from "@/lib/tier";
import { revalidateObservationWrite } from "@/lib/server/revalidate";

export const dynamic = "force-dynamic";

// ── GET — list issued snapshots ───────────────────────────────────────────────

export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (ctx, req) => {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = 20;
    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      ctx.prisma.it3Snapshot.findMany({
        orderBy: { issuedAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          taxYear: true,
          issuedAt: true,
          periodStart: true,
          periodEnd: true,
          generatedBy: true,
          voidedAt: true,
          voidReason: true,
        },
      }),
      ctx.prisma.it3Snapshot.count(),
    ]);

    return NextResponse.json({ records, total, page, limit });
  },
});

// ── POST — issue a new snapshot ───────────────────────────────────────────────

export const POST = tenantWriteSlug<unknown, { farmSlug: string }>({
  revalidate: revalidateObservationWrite,
  handle: async (ctx, parsedBody, _req, { farmSlug }) => {
    if (ctx.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
    if (!(await verifyFreshAdminRole(ctx.session.user.id, ctx.slug))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Tier gate: advanced+ only (Consulting also allowed — Phase L tier extension)
    const creds = await getFarmCreds(farmSlug);
    if (!creds || !isPaidTier(creds.tier)) {
      return NextResponse.json(
        { error: "SARS IT3 Tax Export requires an Advanced subscription." },
        { status: 403 },
      );
    }

    // Rate limit: 5 IT3 issues per 10 minutes per farm (heavy aggregation)
    const rl = checkRateLimit(`it3-issue:${farmSlug}`, 5, 10 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many IT3 export requests. Please wait." },
        { status: 429 },
      );
    }

    // Adapter has already parsed JSON; verify shape before reading fields.
    const body =
      parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)
        ? (parsedBody as Record<string, unknown>)
        : {};

    const taxYearRaw = body.taxYear;
    const taxYear =
      typeof taxYearRaw === "number"
        ? taxYearRaw
        : typeof taxYearRaw === "string"
          ? parseInt(taxYearRaw, 10)
          : NaN;
    if (!Number.isFinite(taxYear) || taxYear < 2000 || taxYear > 2100) {
      return NextResponse.json(
        { error: "taxYear must be a number between 2000 and 2100" },
        { status: 400 },
      );
    }

    try {
      const record = await issueIt3Snapshot(ctx.prisma, {
        taxYear,
        generatedBy: ctx.session.user?.email ?? null,
      });
      return NextResponse.json(record, { status: 201 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to issue IT3 snapshot";
      return NextResponse.json({ error: message }, { status: 422 });
    }
  },
});
