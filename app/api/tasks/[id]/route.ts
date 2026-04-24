/**
 * PATCH /api/tasks/[id] — update a task (ADMIN only)
 * DELETE /api/tasks/[id] — delete a task (ADMIN only)
 *
 * PATCH Phase K additions:
 *   completionPayload — when status → "completed", runs observationFromTaskCompletion.
 *   If the mapping returns non-null, both the task update and observation create
 *   are executed inside a prisma.$transaction. Response includes:
 *     { ...task, observationCreated: boolean, observationId?: string }
 *
 * If the payload is present but incomplete, the PATCH still succeeds with
 *   observationCreated: false (no error — silent null is intentional).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import { verifyFreshAdminRole } from "@/lib/auth";
import { observationFromTaskCompletion } from "@/lib/tasks/observation-mapping";
import type { TaskCompletionPayload } from "@/lib/tasks/observation-mapping";
import { revalidateTaskWrite } from "@/lib/server/revalidate";

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma, role } = db;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, db.slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

  const VALID_STATUSES = new Set(["pending", "in_progress", "completed"]);
  const VALID_PRIORITIES = new Set(["low", "normal", "high"]);

  if (typeof data.status === "string" && VALID_STATUSES.has(data.status))
    update.status = data.status;
  if (typeof data.priority === "string" && VALID_PRIORITIES.has(data.priority))
    update.priority = data.priority;
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

  // ── Phase K: observation creation on completion ──
  const isCompletionTransition =
    update.status === "completed" && existing.status !== "completed";
  const completionPayload = data.completionPayload as TaskCompletionPayload | undefined;

  let observationCreated = false;
  let observationId: string | undefined;

  if (isCompletionTransition && completionPayload && typeof completionPayload === "object") {
    // Build the observation payload from the task + completion data
    const obsPayload = observationFromTaskCompletion(
      {
        id: existing.id,
        taskType: existing.taskType ?? null,
        animalId: existing.animalId ?? null,
        campId: existing.campId ?? null,
        lat: existing.lat ?? null,
        lng: existing.lng ?? null,
        assignedTo: existing.assignedTo,
      },
      completionPayload,
    );

    if (obsPayload !== null) {
      // Execute task update + observation create atomically.
      // Prisma's interactive transaction callback receives an Omit<PrismaClient, ...>
      // not the full PrismaClient — use Parameters<> to derive the correct type.
      type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
      const [updatedTask, createdObs] = await prisma.$transaction(
        async (tx: TxClient) => {
          // Phase I.3 — denormalise species onto Observation at write time
          // so species-scoped repro queries hit the composite index.
          let species: string | null = null;
          if (obsPayload.animalId) {
            const animal = await tx.animal.findUnique({
              where: { animalId: obsPayload.animalId },
              select: { species: true },
            });
            species = animal?.species ?? null;
          }
          // Create observation first so we have its ID
          const obs = await tx.observation.create({
            data: {
              type: obsPayload.type,
              details: obsPayload.details,
              campId: obsPayload.campId ?? existing.campId ?? "unknown",
              animalId: obsPayload.animalId ?? null,
              observedAt: new Date(),
              loggedBy: obsPayload.loggedBy,
              species,
            },
          });

          const task = await tx.task.update({
            where: { id },
            data: { ...update, completedObservationId: obs.id },
          });

          return [task, obs] as const;
        },
      );

      observationCreated = true;
      observationId = createdObs.id;

      revalidateTaskWrite(db.slug);
      return NextResponse.json({
        ...updatedTask,
        observationCreated,
        observationId,
      });
    }
  }

  // ── Standard update (no observation) ──
  const task = await prisma.task.update({ where: { id }, data: update });

  revalidateTaskWrite(db.slug);
  return NextResponse.json({
    ...task,
    observationCreated: false,
  });
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma, role } = db;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, db.slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  await prisma.task.delete({ where: { id } });

  revalidateTaskWrite(db.slug);
  return NextResponse.json({ success: true });
}
