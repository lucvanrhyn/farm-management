/**
 * GET  /api/tasks  — list tasks for the active tenant.
 * POST /api/tasks  — create a task (ADMIN only — fresh-admin re-verify).
 *
 * Wave E (#161) — adapter-only wiring. Auth, body parse, typed-error
 * envelope, and revalidate are owned by `tenantRead` / `adminWrite`.
 * Business logic lives in `lib/domain/tasks/*`.
 *
 * GET has 3 modes (preserved verbatim from pre-Wave-E):
 *   - `as=occurrences&from&to` → TaskOccurrence[] (with `task` included)
 *   - `?limit=N` / `?cursor=X` → `{ tasks, nextCursor, hasMore }`
 *   - default                  → `Task[]` (unbounded — back-compat for
 *     IndexedDB sync + logger fetch)
 *
 * POST body fields (Phase K):
 *   taskType, lat, lng, recurrenceRule, reminderOffset, assigneeIds (array),
 *   templateId, blockedByIds (array)
 *
 * Wire shapes:
 *   - 200 GET unbounded → `Task[]` (parsed assigneeIds + blockedByIds)
 *   - 200 GET paginated → `{ tasks, nextCursor, hasMore }`
 *   - 200 GET occurrences → `TaskOccurrence[]`
 *   - 400 → `{ error: "INVALID_LIMIT" | "INVALID_CURSOR" | "INVALID_RECURRENCE_RULE" | "TEMPLATE_NOT_FOUND" | "VALIDATION_FAILED" }`
 *   - 201 POST → `Task` (parsed)
 *   - 401 / 403 — adapter-emitted (incl. stale-ADMIN re-verify on POST).
 */
import { NextResponse } from "next/server";

import { adminWrite, RouteValidationError, tenantRead } from "@/lib/server/route";
import { revalidateTaskWrite } from "@/lib/server/revalidate";
import { timeAsync } from "@/lib/server/server-timing";
import {
  createTask,
  listTaskOccurrences,
  listTasksPaginated,
  listTasksUnbounded,
  type CreateTaskInput,
} from "@/lib/domain/tasks";

const DEFAULT_LIMIT = 50;

// ── GET ──────────────────────────────────────────────────────────────────────

export const GET = tenantRead({
  handle: async (ctx, req) => {
    const { searchParams } = new URL(req.url);
    const asParam = searchParams.get("as");

    // ── Occurrences mode ──
    if (asParam === "occurrences") {
      const now = new Date();
      const todayStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

      const fromParam = searchParams.get("from");
      const toParam = searchParams.get("to");
      const from = fromParam ? new Date(fromParam) : todayStart;
      const to = toParam ? new Date(toParam) : todayEnd;

      const occurrences = await timeAsync("query", () =>
        listTaskOccurrences(ctx.prisma, { from, to }),
      );
      return NextResponse.json(occurrences);
    }

    // ── Filters (shared between unbounded + paginated) ──
    const filters = {
      assignee: searchParams.get("assignee"),
      status: searchParams.get("status"),
      date: searchParams.get("date"),
      campId: searchParams.get("campId"),
      taskType: searchParams.get("taskType"),
      geo: parseGeo(searchParams),
    };

    // Pagination is opt-in: when neither `limit` nor `cursor` is present, the
    // handler returns the legacy unbounded array shape so existing callers
    // (IndexedDB sync, logger fetch) keep working.
    const limitParam = searchParams.get("limit");
    const cursorParam = searchParams.get("cursor");
    const paginated = limitParam !== null || cursorParam !== null;

    if (!paginated) {
      const tasks = await timeAsync("query", () =>
        listTasksUnbounded(ctx.prisma, filters),
      );
      return NextResponse.json(tasks);
    }

    const rawLimit = limitParam ? Number.parseInt(limitParam, 10) : DEFAULT_LIMIT;
    const result = await timeAsync("query", () =>
      listTasksPaginated(ctx.prisma, {
        filters,
        limit: rawLimit,
        cursor: cursorParam,
      }),
    );
    return NextResponse.json(result);
  },
});

function parseGeo(
  searchParams: URLSearchParams,
): { lat: number; lng: number; radiusKm: number } | null {
  const latParam = searchParams.get("lat");
  const lngParam = searchParams.get("lng");
  const radiusKmParam = searchParams.get("radiusKm");
  if (!latParam || !lngParam || !radiusKmParam) return null;
  const lat = parseFloat(latParam);
  const lng = parseFloat(lngParam);
  const radiusKm = parseFloat(radiusKmParam);
  if (!isFinite(lat) || !isFinite(lng) || !isFinite(radiusKm) || radiusKm <= 0) {
    return null;
  }
  return { lat, lng, radiusKm };
}

// ── POST ─────────────────────────────────────────────────────────────────────

interface CreateTaskBody {
  title: string;
  dueDate: string;
  assignedTo: string;
  description?: string | null;
  status?: string;
  priority?: string;
  campId?: string | null;
  animalId?: string | null;
  taskType?: string | null;
  lat?: number | null;
  lng?: number | null;
  recurrenceRule?: string | null;
  reminderOffset?: number | null;
  assigneeIds?: string[] | null;
  templateId?: string | null;
  blockedByIds?: string[] | null;
  recurrenceSource?: string | null;
}

const createTaskSchema = {
  parse(input: unknown): CreateTaskBody {
    const body = (input ?? {}) as Record<string, unknown>;
    const fieldErrors: Record<string, string> = {};
    if (
      typeof body.title !== "string" ||
      !body.title ||
      body.title.trim() === ""
    ) {
      fieldErrors.title = "title is required";
    }
    if (typeof body.dueDate !== "string" || !body.dueDate) {
      fieldErrors.dueDate = "dueDate is required";
    }
    if (typeof body.assignedTo !== "string" || !body.assignedTo) {
      fieldErrors.assignedTo = "assignedTo is required";
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new RouteValidationError(
        "title, dueDate, assignedTo required",
        { fieldErrors },
      );
    }
    return body as unknown as CreateTaskBody;
  },
};

export const POST = adminWrite<CreateTaskBody>({
  schema: createTaskSchema,
  revalidate: revalidateTaskWrite,
  handle: async (ctx, body) => {
    const input: CreateTaskInput = {
      title: body.title,
      dueDate: body.dueDate,
      assignedTo: body.assignedTo,
      createdBy: ctx.session.user?.email ?? ctx.session.user?.name ?? "unknown",
      description: body.description ?? null,
      status: body.status,
      priority: body.priority,
      campId: body.campId ?? null,
      animalId: body.animalId ?? null,
      taskType: body.taskType ?? null,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      recurrenceRule: body.recurrenceRule ?? null,
      reminderOffset: body.reminderOffset ?? null,
      assigneeIds: body.assigneeIds ?? null,
      templateId: body.templateId ?? null,
      blockedByIds: body.blockedByIds ?? null,
      recurrenceSource: body.recurrenceSource ?? null,
    };
    const task = await createTask(ctx.prisma, input);
    return NextResponse.json(task, { status: 201 });
  },
});
