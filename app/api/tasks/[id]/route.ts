/**
 * PATCH  /api/tasks/[id] — partial-update a task (ADMIN only).
 * DELETE /api/tasks/[id] — delete a task (ADMIN only).
 *
 * Wave E (#161) — adapter-only wiring. Both endpoints are ADMIN-gated
 * with stale-ADMIN re-verify owned by the adapter. Business logic
 * lives in `lib/domain/tasks/{update,delete}-task.ts`.
 *
 * PATCH preserves the Phase K observation-on-completion contract:
 *   - On status:completed transition with valid completionPayload, the
 *     domain op runs `prisma.$transaction` to create the Observation
 *     and link it via `completedObservationId`.
 *   - Response shape always includes `observationCreated: boolean`;
 *     `observationId` is present only on the truthy branch.
 *
 * Wire shapes (preserved verbatim):
 *   - PATCH  200 → updated `Task` row + `{ observationCreated, observationId? }`
 *   - PATCH  404 → `{ error: "TASK_NOT_FOUND" }`
 *   - DELETE 200 → `{ success: true }`
 *   - DELETE 404 → `{ error: "TASK_NOT_FOUND" }`
 *   - 401 / 403 — adapter-emitted (incl. stale-ADMIN re-verify).
 */
import { NextResponse } from "next/server";

import { adminWrite } from "@/lib/server/route";
import { revalidateTaskWrite } from "@/lib/server/revalidate";
import {
  deleteTask,
  updateTask,
  type UpdateTaskInput,
} from "@/lib/domain/tasks";
import type { TaskCompletionPayload } from "@/lib/tasks/observation-mapping";

interface PatchTaskBody extends UpdateTaskInput {
  completionPayload?: TaskCompletionPayload;
}

export const PATCH = adminWrite<PatchTaskBody, { id: string }>({
  revalidate: revalidateTaskWrite,
  handle: async (ctx, body, _req, params) => {
    const { completionPayload, ...input } = body ?? {};
    const result = await updateTask(
      ctx.prisma,
      params.id,
      input,
      completionPayload,
    );
    return NextResponse.json(result);
  },
});

export const DELETE = adminWrite<unknown, { id: string }>({
  revalidate: revalidateTaskWrite,
  handle: async (ctx, _body, _req, params) => {
    const result = await deleteTask(ctx.prisma, params.id);
    return NextResponse.json(result);
  },
});
