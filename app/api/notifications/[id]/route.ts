/**
 * Wave F (#163) — `/api/notifications/[id]` PATCH migrated onto
 * `tenantWrite`. Marks a single notification by id as read; uses
 * `updateMany` so a missing id is a silent no-op (admin UI tolerates this).
 *
 * The Notification model has no `userEmail` column (single-user-per-farm
 * design), so per-farm invalidation is sufficient.
 */
import { NextResponse } from "next/server";

import { tenantWrite } from "@/lib/server/route";
import { markNotificationRead } from "@/lib/domain/notifications";
import { revalidateNotificationWrite } from "@/lib/server/revalidate";

export const PATCH = tenantWrite<unknown, { id: string }>({
  revalidate: revalidateNotificationWrite,
  handle: async (ctx, _body, _req, params) => {
    await markNotificationRead(ctx.prisma, params.id);
    return NextResponse.json({ success: true });
  },
});
