import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma } = db;

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data = body as Record<string, unknown>;

  // Build update payload from allowed fields only
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = {};

  if (typeof data.title === "string" && data.title.trim()) update.title = data.title.trim();
  if (typeof data.description === "string") update.description = data.description;
  if (typeof data.dueDate === "string") update.dueDate = data.dueDate;
  if (typeof data.assignedTo === "string") update.assignedTo = data.assignedTo;
  if (typeof data.status === "string") update.status = data.status;
  if (typeof data.priority === "string") update.priority = data.priority;
  if (typeof data.campId === "string") update.campId = data.campId || null;
  if (typeof data.animalId === "string") update.animalId = data.animalId || null;
  if (typeof data.completedAt === "string") update.completedAt = data.completedAt;

  // Auto-set completedAt when status transitions to completed
  if (update.status === "completed" && !update.completedAt && !existing.completedAt) {
    update.completedAt = new Date().toISOString();
  }
  // Clear completedAt if re-opened
  if (update.status && update.status !== "completed") {
    update.completedAt = null;
  }

  const task = await prisma.task.update({ where: { id }, data: update });

  return NextResponse.json(task);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma } = db;

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  await prisma.task.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
