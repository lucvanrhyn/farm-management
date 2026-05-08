/**
 * Wave F (#163) — `/api/notifications/read-all` POST migrated onto
 * `tenantWrite`. Marks every unread notification in the tenant DB as read.
 *
 * The Notification model has no `userEmail` column (single-user-per-farm
 * design), so this marks all unread notifications across the farm — correct
 * for the current single-user model. Per-user scoping would require a
 * schema migration; out of scope for Wave F.
 */
import { NextResponse } from "next/server";

import { tenantWrite } from "@/lib/server/route";
import { markAllNotificationsRead } from "@/lib/domain/notifications";
import { revalidateNotificationWrite } from "@/lib/server/revalidate";

export const POST = tenantWrite({
  revalidate: revalidateNotificationWrite,
  handle: async (ctx) => {
    await markAllNotificationsRead(ctx.prisma);
    return NextResponse.json({ success: true });
  },
});
