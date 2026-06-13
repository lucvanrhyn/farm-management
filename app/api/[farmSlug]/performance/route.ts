/**
 * GET /api/[farmSlug]/performance — per-camp performance rollup
 * (animal count, latest camp_condition, latest cover reading, stocking density).
 *
 * Wave G4 (#168) — migrated onto `tenantReadSlug`. Inline findMany logic
 * extracted into `lib/domain/performance/listCampPerformance`.
 *
 * Wire-shape preservation (hybrid per ADR-0001 / Wave G4 spec):
 *   - 200 rows shape unchanged.
 *   - 401 envelope migrates from `{ error: "Unauthorized" }` to the
 *     adapter's canonical `{ error: "AUTH_REQUIRED", message: "..." }`.
 *   - S26 (ADR-0001 sweep) — 404 (farm-not-found) → NOT_FOUND and 403 (basic
 *     tier) → FORBIDDEN converge on the canonical typed envelope
 *     `{ error: CODE, message }` (statuses unchanged). The human sentence moves
 *     to the `message` slot; clients that surfaced `body.error` as text now read
 *     `body.message`.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug } from "@/lib/server/route";
import { routeError } from "@/lib/server/route/envelope";
import { getFarmCreds } from "@/lib/meta-db";
import { listCampPerformance } from "@/lib/domain/performance";

export const dynamic = "force-dynamic";

export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (ctx, _req, params) => {
    // Tier-gate is bespoke handler logic (route-level concern, not adapter).
    // Tier must be read live from meta DB — session JWT is cached at login
    // and would lie about recently-upgraded farms until the user re-logs in.
    const creds = await getFarmCreds(params.farmSlug);
    if (!creds) {
      return routeError("NOT_FOUND", "Farm not found", 404);
    }
    if (creds.tier === "basic") {
      return routeError("FORBIDDEN", "Advanced plan required", 403);
    }

    const rows = await listCampPerformance(ctx.prisma);
    return NextResponse.json(rows);
  },
});
