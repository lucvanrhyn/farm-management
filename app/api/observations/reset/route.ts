/**
 * DELETE /api/observations/reset — admin bulk-delete every observation
 * row in the tenant.
 *
 * Wave C (#156) — adapter-only wiring under `adminWrite` (ADMIN role +
 * fresh-admin re-verify enforced by the adapter).
 *
 * Wire shape:
 *   - 200 → `{ success: true, count: number }`
 */
import { NextResponse } from "next/server";

import { adminWrite } from "@/lib/server/route";
import { revalidateObservationWrite } from "@/lib/server/revalidate";
import { resetObservations } from "@/lib/domain/observations";

export const DELETE = adminWrite({
  // Issue #413 — bulk reset wipes every observation regardless of type,
  // which DOES include camp_condition / camp_check rows. Pass
  // `"camp_condition"` so the `farm-<slug>-camps` tag is invalidated
  // along with the default observations + dashboard tags. (Any
  // camp-inspection type would do; the predicate only cares whether
  // the tag is added.)
  handle: async (ctx) => {
    const result = await resetObservations(ctx.prisma);
    revalidateObservationWrite(ctx.slug, "camp_condition");
    return NextResponse.json(result);
  },
});
