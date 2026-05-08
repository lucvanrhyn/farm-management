/**
 * Wave E (#161) — domain op `updateTask`.
 *
 * Updates a task row from a partial input. Allow-list field copy
 * mirrors the pre-Wave-E PATCH route's `update[k] = data[k]` block —
 * status/priority pass through a string-set guard so only valid values
 * land in the Prisma payload.
 *
 * Phase K observation-on-completion contract is preserved verbatim:
 *
 *  - Status flips to "completed" with valid completionPayload →
 *    `prisma.$transaction` runs animal lookup (denormalised species
 *    onto Observation.species) → observation create → task update with
 *    `completedObservationId`. Returns
 *    `{ ...task, observationCreated: true, observationId }`.
 *
 *  - Status flips to "completed" with payload but
 *    `observationFromTaskCompletion` returns null → standard update,
 *    `observationCreated: false`. Silent null is intentional (pure
 *    maintenance taskTypes + missing required payload fields all map
 *    to null per the observation-mapping module).
 *
 *  - Status flips to "completed" with no payload → standard update with
 *    auto-set `completedAt`, `observationCreated: false`.
 *
 *  - Re-open from "completed" → `completedAt: null`.
 *
 *  - Bad id → `TaskNotFoundError`.
 *
 * The `$transaction` callback type derives from
 * `Parameters<Parameters<typeof prisma.$transaction>[0]>[0]` — Prisma's
 * interactive transaction supplies a tx-client that is `Omit<PrismaClient, ...>`
 * not the full `PrismaClient`, so we lift the type from the caller signature
 * rather than importing it from `@prisma/client`.
 */
import type { PrismaClient } from "@prisma/client";

import {
  observationFromTaskCompletion,
  type TaskCompletionPayload,
} from "@/lib/tasks/observation-mapping";

import { TaskNotFoundError } from "./errors";
import { parseTaskArrayFields } from "./list-tasks";

const VALID_STATUSES = new Set(["pending", "in_progress", "completed"]);
const VALID_PRIORITIES = new Set(["low", "normal", "high"]);

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  dueDate?: string;
  assignedTo?: string;
  status?: string;
  priority?: string;
  campId?: string | null;
  animalId?: string | null;
  completedAt?: string | null;
}

export interface UpdateTaskResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
  observationCreated: boolean;
  observationId?: string;
}

export async function updateTask(
  prisma: PrismaClient,
  id: string,
  input: UpdateTaskInput,
  completionPayload?: TaskCompletionPayload,
): Promise<UpdateTaskResult> {
  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) {
    throw new TaskNotFoundError(id);
  }

  // Build update payload from allowed fields only.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = {};

  if (typeof input.title === "string" && input.title.trim()) {
    update.title = input.title.trim();
  }
  if (typeof input.description === "string") update.description = input.description;
  if (typeof input.dueDate === "string") update.dueDate = input.dueDate;
  if (typeof input.assignedTo === "string") update.assignedTo = input.assignedTo;

  if (typeof input.status === "string" && VALID_STATUSES.has(input.status)) {
    update.status = input.status;
  }
  if (typeof input.priority === "string" && VALID_PRIORITIES.has(input.priority)) {
    update.priority = input.priority;
  }
  if (typeof input.campId === "string") update.campId = input.campId || null;
  if (typeof input.animalId === "string") update.animalId = input.animalId || null;
  if (typeof input.completedAt === "string") update.completedAt = input.completedAt;

  // Auto-set completedAt when status transitions to completed.
  if (update.status === "completed" && !update.completedAt && !existing.completedAt) {
    update.completedAt = new Date().toISOString();
  }
  // Clear completedAt if re-opened.
  if (update.status && update.status !== "completed") {
    update.completedAt = null;
  }

  // ── Phase K: observation creation on completion ──
  const isCompletionTransition =
    update.status === "completed" && existing.status !== "completed";

  if (
    isCompletionTransition &&
    completionPayload &&
    typeof completionPayload === "object"
  ) {
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
      // Execute task update + observation create atomically. Prisma's
      // interactive transaction callback receives an Omit<PrismaClient, ...>
      // not the full PrismaClient — derive TxClient from the callsite to
      // avoid pulling a type from a wrong place.
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

      return {
        ...parseTaskArrayFields(updatedTask),
        observationCreated: true,
        observationId: createdObs.id,
      };
    }
  }

  // ── Standard update (no observation) ──
  const task = await prisma.task.update({ where: { id }, data: update });

  return {
    ...parseTaskArrayFields(task),
    observationCreated: false,
  };
}
