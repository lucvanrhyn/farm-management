import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    // Append to audit trail before overwriting
    const previousHistory: unknown[] = existing.editHistory
      ? JSON.parse(existing.editHistory)
      : [];
    const newHistory = [
      ...previousHistory,
      {
        editedBy: session.user?.email ?? "unknown",
        editedAt: new Date().toISOString(),
        previousDetails: existing.details,
      },
    ];

    const updated = await prisma.observation.update({
      where: { id },
      data: {
        details,
        editedBy: session.user?.email ?? null,
        editedAt: new Date(),
        editHistory: JSON.stringify(newHistory),
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[observations PATCH] DB error:", err);
    return NextResponse.json({ error: "Failed to update observation" }, { status: 500 });
  }
}
