/**
 * Wave F (#163) — domain op `markNotificationRead`.
 *
 * Pre-Wave-F home: `app/api/notifications/[id]/route.ts` PATCH. Uses
 * `updateMany` rather than `update` so a missing id silently no-ops — the
 * admin notification bell may PATCH a row that's already been swept by the
 * cron expiry job, and a 404 there would surface as a transient error.
 *
 * No business-rule errors — adapter handles 401/403.
 */
import type { PrismaClient } from "@prisma/client";

export async function markNotificationRead(
  prisma: PrismaClient,
  id: string,
): Promise<{ success: true }> {
  await prisma.notification.updateMany({
    where: { id },
    data: { isRead: true },
  });
  return { success: true };
}
