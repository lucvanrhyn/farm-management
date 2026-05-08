/**
 * GET  /api/[farmSlug]/rotation/plans — list every rotation plan (with steps).
 * POST /api/[farmSlug]/rotation/plans — create a new rotation plan
 *                                       (ADMIN, fresh-admin re-verified).
 *
 * Wave G2 (#166) — migrated onto `tenantReadSlug` / `adminWriteSlug`.
 *
 * Wire-shape preservation:
 *   - 200 list shape unchanged.
 *   - 201 create shape unchanged.
 *   - 401 / 403 envelopes migrate from `{ error: "Unauthorized" }` /
 *     `{ error: "Forbidden" }` to `AUTH_REQUIRED` / `FORBIDDEN` codes.
 *   - 400 validation paths now mint typed errors:
 *       * "name is required" → MISSING_FIELD `field=name`
 *       * "startDate is required" → MISSING_FIELD `field=startDate`
 *       * "startDate is invalid" → INVALID_DATE `field=startDate`
 *     Audited 2026-05-08: zero client components in `app/` or
 *     `components/` key on the legacy bare-string `error` value, so
 *     Option A (SCREAMING_SNAKE codes) is safe.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug, adminWriteSlug } from "@/lib/server/route";
import { revalidateRotationWrite } from "@/lib/server/revalidate";
import {
  createRotationPlan,
  listRotationPlans,
  type CreateRotationPlanInput,
} from "@/lib/domain/rotation";

export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (ctx) => {
    const plans = await listRotationPlans(ctx.prisma);
    return NextResponse.json(plans);
  },
});

export const POST = adminWriteSlug<CreateRotationPlanInput, { farmSlug: string }>({
  revalidate: revalidateRotationWrite,
  handle: async (ctx, body) => {
    const plan = await createRotationPlan(ctx.prisma, body);
    return NextResponse.json(plan, { status: 201 });
  },
});
