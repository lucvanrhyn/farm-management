import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import { revalidateNotificationWrite } from "@/lib/server/revalidate";

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma } = db;

  const { id } = await params;

  await prisma.notification.updateMany({
    where: { id },
    data: { isRead: true },
  });

  // Invalidate the cached /api/notifications response so the bell reflects
  // the new isRead state without waiting out the 30s server TTL. Notification
  // model has no userEmail column (single-user-per-farm), so farm-scoped
  // invalidation is sufficient.
  revalidateNotificationWrite(db.slug);

  return NextResponse.json({ success: true });
}
