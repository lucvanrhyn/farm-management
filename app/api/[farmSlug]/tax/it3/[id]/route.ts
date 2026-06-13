/**
 * GET /api/[farmSlug]/tax/it3/[id] — return a single IT3 snapshot
 *
 * Wave G8 (#172) — migrated onto `tenantReadSlug`. Final feature wave of the
 * ADR-0001 7/8 rollout.
 *
 * Wire-shape preservation:
 *   - 200 success unchanged.
 *   - 401 envelope migrates to the adapter's canonical `AUTH_REQUIRED` typed
 *     envelope.
 *   - S26 (ADR-0001 sweep) — 404 converges on the canonical typed envelope
 *     `{ error: "NOT_FOUND", message: "IT3 snapshot not found" }` (status
 *     unchanged); the human sentence moves to the `message` slot.
 *
 * No tier-gate here: any authenticated farm member may read a snapshot.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug } from "@/lib/server/route";
import { routeError } from "@/lib/server/route/envelope";

export const dynamic = "force-dynamic";

export const GET = tenantReadSlug<{ farmSlug: string; id: string }>({
  handle: async (ctx, _req, { id }) => {
    const record = await ctx.prisma.it3Snapshot.findUnique({ where: { id } });
    if (!record) {
      return routeError("NOT_FOUND", "IT3 snapshot not found", 404);
    }
    return NextResponse.json(record);
  },
});
