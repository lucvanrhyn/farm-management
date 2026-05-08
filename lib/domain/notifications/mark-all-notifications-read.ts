/**
 * Wave F (#163) — domain op `markAllNotificationsRead`.
 *
 * Pre-Wave-F home: `app/api/notifications/read-all/route.ts` POST. The
 * Notification model has no `userEmail` column (single-user-per-farm
 * design), so the op marks every unread notification in the tenant DB as
 * read. Per-user scoping would require a schema migration — out of scope.
 *
 * No business-rule errors — adapter handles 401/403.
 */
import type { PrismaClient } from "@prisma/client";

export async function markAllNotificationsRead(
  prisma: PrismaClient,
): Promise<{ success: true }> {
  await prisma.notification.updateMany({
    where: { isRead: false },
    data: { isRead: true },
  });
  return { success: true };
}
