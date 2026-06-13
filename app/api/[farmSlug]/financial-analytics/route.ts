/**
 * GET /api/[farmSlug]/financial-analytics — financial KPIs over a date range.
 *
 * Wave G4 (#168) — migrated onto `tenantReadSlug`.
 *
 * Wire-shape preservation (hybrid per Wave G4 spec):
 *   - 200 payload shape unchanged (delegates to `getFinancialAnalytics`
 *     from `lib/server/financial-analytics` — outside the wave's allow-list
 *     to extract; many other consumers reference it).
 *   - 401 envelope migrates from `{ error: "Unauthorized" }` to the
 *     adapter's canonical `{ error: "AUTH_REQUIRED", message: "..." }`.
 *   - S26 (ADR-0001 sweep) — 404 (farm-not-found) → NOT_FOUND, 403 (basic
 *     tier) → FORBIDDEN, 400 (invalid-date) → VALIDATION_FAILED converge on the
 *     canonical typed envelope `{ error: CODE, message }` (statuses unchanged).
 *     The human sentence moves to the `message` slot; clients that surfaced
 *     `body.error` as text now read `body.message`.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug } from "@/lib/server/route";
import { routeError } from "@/lib/server/route/envelope";
import { getFarmCreds } from "@/lib/meta-db";
import { getFinancialAnalytics } from "@/lib/server/financial-analytics";

export const dynamic = "force-dynamic";

export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (ctx, req, params) => {
    // Tier-gate is bespoke handler logic. Tier must be read live from meta
    // DB — session JWT is cached at login and would lie about
    // recently-upgraded farms until the user re-logs in.
    const creds = await getFarmCreds(params.farmSlug);
    if (!creds) {
      return routeError("NOT_FOUND", "Farm not found", 404);
    }
    if (creds.tier === "basic") {
      return routeError("FORBIDDEN", "Advanced plan required", 403);
    }

    const { searchParams } = new URL(req.url);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    const to = toParam ? new Date(toParam) : new Date();
    const from = fromParam ? new Date(fromParam) : new Date(0); // epoch = all-time

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return routeError("VALIDATION_FAILED", "Invalid date params");
    }

    const result = await getFinancialAnalytics(ctx.prisma, from, to);
    return NextResponse.json(result);
  },
});
