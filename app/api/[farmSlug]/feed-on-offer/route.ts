/**
 * GET /api/[farmSlug]/feed-on-offer — feed-on-offer summary payload.
 *
 * Wave G4 (#168) — migrated onto `tenantReadSlug`.
 *
 * Wire-shape preservation:
 *   - 200 payload shape unchanged (delegates to `getFarmFeedOnOfferPayload`
 *     from `lib/server/feed-on-offer` — outside the wave's allow-list to
 *     extract; outside consumers include
 *     `components/feed-on-offer/FeedOnOfferCampTable.tsx` and
 *     `app/[farmSlug]/admin/camps/page.tsx`).
 *   - 401 envelope migrates from `{ error: "Unauthorized" }` to the
 *     adapter's canonical `{ error: "AUTH_REQUIRED", message: "..." }`.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug } from "@/lib/server/route";
import { getFarmFeedOnOfferPayload } from "@/lib/server/feed-on-offer";

export const dynamic = "force-dynamic";

export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (ctx) => {
    const payload = await getFarmFeedOnOfferPayload(ctx.prisma);
    return NextResponse.json(payload);
  },
});
