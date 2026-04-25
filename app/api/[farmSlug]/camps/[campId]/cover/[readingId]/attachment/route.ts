import { NextRequest, NextResponse } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
import { logger } from "@/lib/logger";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ farmSlug: string; campId: string; readingId: string }> },
) {
  const { farmSlug, campId, readingId } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma } = ctx;

  const body = await request.json();
  const { attachmentUrl } = body;

  if (typeof attachmentUrl !== "string" || !attachmentUrl) {
    return NextResponse.json(
      { error: "attachmentUrl must be a non-empty string" },
      { status: 400 },
    );
  }

  try {
    const existing = await prisma.campCoverReading.findFirst({
      where: { id: readingId, campId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updated = await prisma.campCoverReading.update({
      where: { id: readingId },
      data: { attachmentUrl },
    });

    return NextResponse.json({ success: true, attachmentUrl: updated.attachmentUrl });
  } catch (err) {
    logger.error('[cover/attachment PATCH] DB error', err);
    return NextResponse.json({ error: "Failed to update attachment" }, { status: 500 });
  }
}
