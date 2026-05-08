/**
 * GET /api/[farmSlug]/profitability-by-animal — per-animal P&L rows.
 *
 * Wave G4 (#168) — migrated onto `tenantReadSlug`.
 *
 * Wire-shape preservation (hybrid per Wave G4 spec):
 *   - 200 rows shape unchanged (delegates to `getProfitabilityByAnimal`
 *     from `lib/server/profitability-by-animal` — outside the wave's
 *     allow-list to extract; many other consumers reference it).
 *   - 401 envelope migrates from `{ error: "Unauthorized" }` to the
 *     adapter's canonical `{ error: "AUTH_REQUIRED", message: "..." }`.
 *   - 404 (farm-not-found), 403 (not-advanced+), 400 (invalid-date),
 *     500 (internal-error) keep their bare-string `{ error: "<sentence>" }`
 *     envelopes — these are bespoke handler concerns.
 *
 * Tier predicate note: `profitability-by-animal` gates on
 * `!ADVANCED_TIERS.has(creds.tier)` (advanced/enterprise/consulting), not
 * the simpler `creds.tier === "basic"` used by the other tier-gated routes
 * in this slice. Predicate preserved verbatim.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug } from "@/lib/server/route";
import { getFarmCreds } from "@/lib/meta-db";
import { getProfitabilityByAnimal } from "@/lib/server/profitability-by-animal";
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
      return NextResponse.json({ error: "Farm not found" }, { status: 404 });
    }
    if (!ADVANCED_TIERS.has(creds.tier)) {
      return NextResponse.json(
        { error: "Advanced plan required" },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(req.url);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    let dateRange: { from: string; to: string } | undefined;
    if (fromParam && toParam) {
      const fromDate = new Date(fromParam);
      const toDate = new Date(toParam);
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return NextResponse.json(
          { error: "Invalid date params" },
          { status: 400 },
        );
      }
      dateRange = { from: fromParam, to: toParam };
    }

    try {
      const rows = await getProfitabilityByAnimal(ctx.prisma, dateRange);
      return NextResponse.json(rows);
    } catch (err) {
      logger.error("[profitability-by-animal] query failed", err);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
  },
});
