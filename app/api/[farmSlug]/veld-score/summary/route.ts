/**
 * GET /api/[farmSlug]/veld-score/summary — farm-level veld summary.
 *
 * Wave G4 (#168) — migrated onto `tenantReadSlug`.
 *
 * Wire-shape preservation:
 *   - 200 payload shape unchanged (delegates to `getFarmSummary` from
 *     `lib/server/veld-score` — outside the wave's allow-list to extract;
 *     outside consumers include `components/veld/VeldTrendChart.tsx`,
 *     `VeldCampSummaryCards.tsx`, and `app/[farmSlug]/admin/camps/page.tsx`).
 *   - 401 envelope migrates from `{ error: "Unauthorized" }` to the
 *     adapter's canonical `{ error: "AUTH_REQUIRED", message: "..." }`.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug } from "@/lib/server/route";
import { getFarmSummary } from "@/lib/server/veld-score";

export const dynamic = "force-dynamic";

export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (ctx) => {
    const summary = await getFarmSummary(ctx.prisma);
    return NextResponse.json(summary);
  },
});
