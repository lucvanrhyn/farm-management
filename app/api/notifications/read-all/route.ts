import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { revalidateNotificationWrite } from "@/lib/server/revalidate";

export async function POST(req: NextRequest) {
  const ctx = await getFarmContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, slug } = ctx;

  // Note: the Notification model has no userEmail column (single-user-per-farm design).
  // This marks all unread notifications in the farm DB as read, which is correct for
  // the current single-user model. Adding per-user scope would require a schema migration.
  await prisma.notification.updateMany({
    where: { isRead: false },
    data: { isRead: true },
  });

  // Invalidate the cached /api/notifications response so the bell reflects
  // the new isRead state without waiting out the 30s server TTL.
  revalidateNotificationWrite(slug);

  return NextResponse.json({ success: true });
}
