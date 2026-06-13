/**
 * GET /api/[farmSlug]/profitability-by-animal — per-animal P&L rows.
 *
 * Wave G4 (#168) — migrated onto `tenantReadSlug`.
 *
 * Wire-shape preservation (hybrid per Wave G4 spec):
 *   - 200 rows shape unchanged (delegates to `getProfitabilityByAnimal`,
 *     now a transactions-domain op in `lib/domain/transactions` — Wave 309c
 *     (ADR-0001 Wave B, #309) extracted it from the old `lib/server/`
 *     module; this route is its sole caller).
 *   - 401 envelope migrates from `{ error: "Unauthorized" }` to the
 *     adapter's canonical `{ error: "AUTH_REQUIRED", message: "..." }`.
 *   - S26 (ADR-0001 sweep) — 404 (farm-not-found) → NOT_FOUND, 403
 *     (not-advanced+) → FORBIDDEN, 400 (invalid-date) → VALIDATION_FAILED, 500
 *     (query failure) → opaque DB_QUERY_FAILED converge on the canonical typed
 *     envelope (statuses unchanged). The human sentence moves to `message`
 *     (except the opaque 500, which carries no message to avoid leaking
 *     internal error text).
 *
 * Tier predicate note: `profitability-by-animal` gates on
 * `!ADVANCED_TIERS.has(creds.tier)` (advanced/enterprise/consulting), not
 * the simpler `creds.tier === "basic"` used by the other tier-gated routes
 * in this slice. Predicate preserved verbatim.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug } from "@/lib/server/route";
import { routeError } from "@/lib/server/route/envelope";
import { getFarmCreds } from "@/lib/meta-db";
import { getProfitabilityByAnimal } from "@/lib/domain/transactions";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const ADVANCED_TIERS = new Set(["advanced", "enterprise", "consulting"]);

export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (ctx, req, params) => {
    // Tier-gate is bespoke handler logic. Read tier from meta-db — the
    // fast-path synthesised session only carries role, not tier, so we
    // can't rely on session.user.farms[*].tier here.
    const creds = await getFarmCreds(params.farmSlug);
    if (!creds) {
      return routeError("NOT_FOUND", "Farm not found", 404);
    }
    if (!ADVANCED_TIERS.has(creds.tier)) {
      return routeError("FORBIDDEN", "Advanced plan required", 403);
    }

    const { searchParams } = new URL(req.url);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    let dateRange: { from: string; to: string } | undefined;
    if (fromParam && toParam) {
      const fromDate = new Date(fromParam);
      const toDate = new Date(toParam);
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return routeError("VALIDATION_FAILED", "Invalid date params");
      }
      dateRange = { from: fromParam, to: toParam };
    }

    try {
      const rows = await getProfitabilityByAnimal(ctx.prisma, dateRange);
      return NextResponse.json(rows);
    } catch (err) {
      // S26 ADR-0001 / api-M1 — collapse the query failure to the canonical
      // opaque DB_QUERY_FAILED envelope (no `message`) so no raw error text can
      // leak; the full error is preserved in the server log above. Status 500
      // is DB_QUERY_FAILED's DEFAULT_STATUS, so it is inferred (not passed).
      logger.error("[profitability-by-animal] query failed", err);
      return routeError("DB_QUERY_FAILED");
    }
  },
});
