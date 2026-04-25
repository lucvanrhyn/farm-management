import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateObservationWrite } from "@/lib/server/revalidate";
import { logger } from "@/lib/logger";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getFarmContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, session, slug } = ctx;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const existing = await prisma.observation.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.observation.delete({ where: { id } });

    revalidateObservationWrite(slug);
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('[observations DELETE] DB error', err);
    return NextResponse.json({ error: "Failed to delete observation" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getFarmContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, session, slug } = ctx;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const { details } = body;

  if (typeof details !== "string") {
    return NextResponse.json({ error: "details must be a JSON string" }, { status: 400 });
  }

  try {
    const existing = await prisma.observation.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Append to audit trail before overwriting — cap at 50 entries to prevent unbounded growth
    const previousHistory: unknown[] = existing.editHistory
      ? JSON.parse(existing.editHistory)
      : [];
    const rawHistory = [
      ...previousHistory,
      {
        editedBy: session.user?.email ?? "unknown",
        editedAt: new Date().toISOString(),
        previousDetails: existing.details,
      },
    ];
    const newHistory = rawHistory.slice(-50);

    const updated = await prisma.observation.update({
      where: { id },
      data: {
        details,
        editedBy: session.user?.email ?? null,
        editedAt: new Date(),
        editHistory: JSON.stringify(newHistory),
      },
    });

    revalidateObservationWrite(slug);
    return NextResponse.json(updated);
  } catch (err) {
    logger.error('[observations PATCH] DB error', err);
    return NextResponse.json({ error: "Failed to update observation" }, { status: 500 });
  }
}
