import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import { revalidateNotificationWrite } from "@/lib/server/revalidate";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma } = db;

  // Note: the Notification model has no userEmail column (single-user-per-farm design).
  // This marks all unread notifications in the farm DB as read, which is correct for
  // the current single-user model. Adding per-user scope would require a schema migration.
  await prisma.notification.updateMany({
    where: { isRead: false },
    data: { isRead: true },
  });

  // Invalidate the cached /api/notifications response so the bell reflects
  // the new isRead state without waiting out the 30s server TTL.
  revalidateNotificationWrite(db.slug);

  return NextResponse.json({ success: true });
}
