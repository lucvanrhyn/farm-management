import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma } = db;

  const { searchParams } = new URL(req.url);
  const assignee = searchParams.get("assignee");
  const status = searchParams.get("status");
  const date = searchParams.get("date");
  const campId = searchParams.get("campId");

  // Build where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {};

  if (assignee) {
    where.assignedTo = assignee;
  }

  if (status) {
    // Allow comma-separated statuses: ?status=pending,in_progress
    const statuses = status.split(",").map((s) => s.trim()).filter(Boolean);
    where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
  }

  if (date) {
    where.dueDate = date;
  }

  if (campId) {
    where.campId = campId;
  }

  const tasks = await prisma.task.findMany({
    where,
    orderBy: [{ dueDate: "asc" }, { priority: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json(tasks);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma, role } = db;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data = body as Record<string, unknown>;

  if (!data.title || typeof data.title !== "string" || data.title.trim() === "") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!data.dueDate || typeof data.dueDate !== "string") {
    return NextResponse.json({ error: "dueDate is required" }, { status: 400 });
  }
  if (!data.assignedTo || typeof data.assignedTo !== "string") {
    return NextResponse.json({ error: "assignedTo is required" }, { status: 400 });
  }

  const task = await prisma.task.create({
    data: {
      title: data.title.trim(),
      description: typeof data.description === "string" ? data.description : null,
      dueDate: data.dueDate,
      assignedTo: data.assignedTo,
      createdBy: session.user?.email ?? session.user?.name ?? "unknown",
      status: typeof data.status === "string" ? data.status : "pending",
      priority: typeof data.priority === "string" ? data.priority : "normal",
      campId: typeof data.campId === "string" && data.campId ? data.campId : null,
      animalId: typeof data.animalId === "string" && data.animalId ? data.animalId : null,
    },
  });

  return NextResponse.json(task, { status: 201 });
}
