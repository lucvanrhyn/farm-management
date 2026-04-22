import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForSlugWithAuth } from "@/lib/farm-prisma";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ farmSlug: string; campId: string; readingId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { farmSlug, campId, readingId } = await params;
  const auth = await getPrismaForSlugWithAuth(session, farmSlug);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { prisma } = auth;

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
    console.error("[cover/attachment PATCH] DB error:", err);
    return NextResponse.json({ error: "Failed to update attachment" }, { status: 500 });
  }
}
