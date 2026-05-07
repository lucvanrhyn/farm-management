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
  revalidate: revalidateObservationWrite,
  handle: async (ctx) => {
    const result = await resetObservations(ctx.prisma);
    return NextResponse.json(result);
  },
});
