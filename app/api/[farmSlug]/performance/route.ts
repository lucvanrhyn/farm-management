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
 *   - 404 (farm-not-found) and 403 (basic tier) keep their bare-string
 *     `{ error: "<sentence>" }` envelopes — these are bespoke handler
 *     concerns, not adapter concerns. Existing clients
 *     (`components/admin/PerformanceSection.tsx`) may key on `body.error`
 *     as user-facing text, so the wire shape is preserved verbatim.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug } from "@/lib/server/route";
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
      return NextResponse.json({ error: "Farm not found" }, { status: 404 });
    }
    if (creds.tier === "basic") {
      return NextResponse.json(
        { error: "Advanced plan required" },
        { status: 403 },
      );
    }

    const rows = await listCampPerformance(ctx.prisma);
    return NextResponse.json(rows);
  },
});
