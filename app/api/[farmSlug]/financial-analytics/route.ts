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
 *   - 404 (farm-not-found), 403 (basic tier), 400 (invalid-date) keep
 *     their bare-string `{ error: "<sentence>" }` envelopes — these are
 *     bespoke handler concerns. Existing clients
 *     (`components/admin/FinancialAnalyticsPanel.tsx` etc.) may key on
 *     `body.error` as user-facing text.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug } from "@/lib/server/route";
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
      return NextResponse.json({ error: "Farm not found" }, { status: 404 });
    }
    if (creds.tier === "basic") {
      return NextResponse.json(
        { error: "Advanced plan required" },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(req.url);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    const to = toParam ? new Date(toParam) : new Date();
    const from = fromParam ? new Date(fromParam) : new Date(0); // epoch = all-time

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return NextResponse.json(
        { error: "Invalid date params" },
        { status: 400 },
      );
    }

    const result = await getFinancialAnalytics(ctx.prisma, from, to);
    return NextResponse.json(result);
  },
});
