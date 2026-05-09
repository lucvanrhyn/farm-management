/**
 * GET /api/[farmSlug]/tax/it3/preview?taxYear=YYYY
 *
 * Non-persisting preview of the IT3 payload for a tax year. Used by the issue
 * form so the farmer can inspect totals before committing a snapshot.
 *
 * Wave G8 (#172) — migrated onto `tenantReadSlug`. Final feature wave of the
 * ADR-0001 7/8 rollout.
 *
 * Wire-shape preservation:
 *   - 200 success unchanged.
 *   - 401 envelope migrates to the adapter's canonical `AUTH_REQUIRED` typed
 *     envelope.
 *   - 403 tier-gate and 400 taxYear-range bare-string envelopes preserved
 *     verbatim for the IT3 issue form's `body.error` toast.
 *
 * NOTE — pre-existing tier-gate inconsistency (preserved verbatim, do NOT
 * "fix" in this wave): preview uses the strict `creds.tier !== "advanced"`
 * check while POST in `../route.ts` uses `isPaidTier(creds.tier)` (which
 * accepts both `"advanced"` and `"consulting"`). Preview therefore blocks
 * consulting-tier farmers from preview-rendering even though they can issue
 * snapshots. Flagged in the Wave G8 PR body for a future security-hardening
 * wave to decide intentional vs. bug.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug } from "@/lib/server/route";
import { getFarmCreds } from "@/lib/meta-db";
import { getIt3Payload } from "@/lib/server/sars-it3";

export const dynamic = "force-dynamic";

export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (ctx, req, { farmSlug }) => {
    const creds = await getFarmCreds(farmSlug);
    if (!creds || creds.tier !== "advanced") {
      return NextResponse.json(
        { error: "SARS IT3 Tax Export requires an Advanced subscription." },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(req.url);
    const taxYearRaw = searchParams.get("taxYear");
    const taxYear = taxYearRaw ? parseInt(taxYearRaw, 10) : NaN;
    if (!Number.isFinite(taxYear) || taxYear < 2000 || taxYear > 2100) {
      return NextResponse.json(
        { error: "taxYear query parameter must be a number between 2000 and 2100" },
        { status: 400 },
      );
    }

    const payload = await getIt3Payload(ctx.prisma, taxYear, ctx.session.user?.email ?? null);
    return NextResponse.json(payload);
  },
});
