import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { revalidateNotificationWrite } from "@/lib/server/revalidate";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getFarmContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, slug } = ctx;

  const { id } = await params;

  await prisma.notification.updateMany({
    where: { id },
    data: { isRead: true },
  });

  // Invalidate the cached /api/notifications response so the bell reflects
  // the new isRead state without waiting out the 30s server TTL. Notification
  // model has no userEmail column (single-user-per-farm), so farm-scoped
  // invalidation is sufficient.
  revalidateNotificationWrite(slug);

  return NextResponse.json({ success: true });
}
