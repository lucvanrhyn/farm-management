/**
 * GET  /api/tasks  — list tasks for the active tenant
 * POST /api/tasks  — create a task (ADMIN only)
 *
 * GET query params:
 *   assignee  - filter by assignedTo (exact)
 *   status    - comma-separated statuses
 *   date      - filter by dueDate (exact string)
 *   campId    - filter by campId
 *   taskType  - filter by taskType (exact)
 *   lat, lng, radiusKm - bounding-box filter (small-angle approximation)
 *   as=occurrences     - return TaskOccurrence[] for a time window instead
 *   from, to           - ISO datetime range for as=occurrences
 *
 * POST body fields (new for Phase K):
 *   taskType, lat, lng, recurrenceRule, reminderOffset, assigneeIds (array),
 *   templateId, blockedByIds (array)
 *
 * Error codes:
 *   INVALID_RECURRENCE_RULE — recurrenceRule is syntactically invalid
 *   TEMPLATE_NOT_FOUND      — templateId provided but template does not exist
 */

import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { expandRule } from "@/lib/tasks/recurrence";
import { revalidateTaskWrite } from "@/lib/server/revalidate";
import { withServerTiming, timeAsync } from "@/lib/server/server-timing";

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  return withServerTiming(async () => {
    const ctx = await timeAsync("session", () => getFarmContext(req));
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { prisma } = ctx;

    const { searchParams } = new URL(req.url);
    const assignee = searchParams.get("assignee");
    const status = searchParams.get("status");
    const date = searchParams.get("date");
    const campId = searchParams.get("campId");
    const taskType = searchParams.get("taskType");
    const asParam = searchParams.get("as");
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    // Geo-filter params
    const latParam = searchParams.get("lat");
    const lngParam = searchParams.get("lng");
    const radiusKmParam = searchParams.get("radiusKm");

    // ── Occurrences mode ──
    if (asParam === "occurrences") {
      const now = new Date();
      const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

      const from = fromParam ? new Date(fromParam) : todayStart;
      const to = toParam ? new Date(toParam) : todayEnd;

      const occurrences = await timeAsync("query", () =>
        prisma.taskOccurrence.findMany({
          where: {
            occurrenceAt: { gte: from, lte: to },
          },
          include: { task: true },
          orderBy: { occurrenceAt: "asc" },
        }),
      );
      return NextResponse.json(occurrences);
    }

    // ── Standard task list mode ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};

    if (assignee) where.assignedTo = assignee;

    if (status) {
      const statuses = status
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
    }

    if (date) where.dueDate = date;
    if (campId) where.campId = campId;
    if (taskType) where.taskType = taskType;

    // Bounding-box geo filter — small-angle approximation
    // 1 degree latitude ≈ 111 km; longitude varies by cos(lat) but we use lat
    // as an approximation (acceptable error < 5% within SA at ~30°S).
    if (latParam && lngParam && radiusKmParam) {
      const lat = parseFloat(latParam);
      const lng = parseFloat(lngParam);
      const radiusKm = parseFloat(radiusKmParam);
      if (!isNaN(lat) && !isNaN(lng) && !isNaN(radiusKm) && radiusKm > 0) {
        const deltaLat = radiusKm / 111;
        const deltaLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
        where.lat = { gte: lat - deltaLat, lte: lat + deltaLat };
        where.lng = { gte: lng - deltaLng, lte: lng + deltaLng };
      }
    }

    const tasks = await timeAsync("query", () =>
      prisma.task.findMany({
        where,
        orderBy: [{ dueDate: "asc" }, { priority: "asc" }, { createdAt: "asc" }],
      }),
    );

    // Parse JSON-stringified arrays before returning
    const parsed = tasks.map(parseTaskArrayFields);

    return NextResponse.json(parsed);
  });
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const ctx = await getFarmContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, slug, session } = ctx;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data = body as Record<string, unknown>;

  // ── Validate recurrenceRule early (before DB write) ──
  if (typeof data.recurrenceRule === "string" && data.recurrenceRule.trim() !== "") {
    try {
      // Dry-run validation: expand with an empty context, 1-day horizon.
      // This will throw UNKNOWN_RECURRENCE_RULE for malformed rules.
      expandRule(data.recurrenceRule, new Date(), 1, { events: [], seasonWindows: {} });
    } catch {
      return NextResponse.json(
        { error: "Invalid recurrence rule", code: "INVALID_RECURRENCE_RULE" },
        { status: 400 },
      );
    }
  }

  // ── Load template if provided ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let templateDefaults: Record<string, any> = {};
  if (typeof data.templateId === "string" && data.templateId) {
    const tmpl = await prisma.taskTemplate.findUnique({ where: { id: data.templateId } });
    if (!tmpl) {
      return NextResponse.json(
        { error: "Template not found", code: "TEMPLATE_NOT_FOUND" },
        { status: 400 },
      );
    }
    templateDefaults = {
      taskType: tmpl.taskType,
      recurrenceRule: tmpl.recurrenceRule,
      reminderOffset: tmpl.reminderOffset,
    };
  }

  // ── Required field validation ──
  if (!data.title || typeof data.title !== "string" || data.title.trim() === "") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!data.dueDate || typeof data.dueDate !== "string") {
    return NextResponse.json({ error: "dueDate is required" }, { status: 400 });
  }
  if (!data.assignedTo || typeof data.assignedTo !== "string") {
    return NextResponse.json({ error: "assignedTo is required" }, { status: 400 });
  }

  // ── Merge: explicit fields override template defaults ──
  const resolvedTaskType =
    typeof data.taskType === "string" ? data.taskType : templateDefaults.taskType ?? null;
  const resolvedRecurrenceRule =
    typeof data.recurrenceRule === "string" && data.recurrenceRule.trim()
      ? data.recurrenceRule
      : templateDefaults.recurrenceRule ?? null;
  const resolvedReminderOffset =
    typeof data.reminderOffset === "number"
      ? data.reminderOffset
      : templateDefaults.reminderOffset ?? null;

  // Serialize array fields for SQLite storage
  const assigneeIds =
    Array.isArray(data.assigneeIds) ? JSON.stringify(data.assigneeIds) : null;
  const blockedByIds =
    Array.isArray(data.blockedByIds) ? JSON.stringify(data.blockedByIds) : null;

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
      // Phase K new fields
      taskType: resolvedTaskType,
      lat: typeof data.lat === "number" ? data.lat : null,
      lng: typeof data.lng === "number" ? data.lng : null,
      recurrenceRule: resolvedRecurrenceRule,
      reminderOffset: resolvedReminderOffset,
      assigneeIds,
      templateId: typeof data.templateId === "string" && data.templateId ? data.templateId : null,
      blockedByIds,
      completedObservationId: null,
      recurrenceSource: typeof data.recurrenceSource === "string" ? data.recurrenceSource : null,
    },
  });

  revalidateTaskWrite(slug);
  return NextResponse.json(parseTaskArrayFields(task), { status: 201 });
}

// ── Utility ───────────────────────────────────────────────────────────────────

/**
 * Parse assigneeIds and blockedByIds from JSON strings to arrays before
 * returning to the client, so the API contract returns proper arrays.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseTaskArrayFields(task: Record<string, any>): Record<string, any> {
  return {
    ...task,
    assigneeIds: safeParseArray(task.assigneeIds),
    blockedByIds: safeParseArray(task.blockedByIds),
  };
}

function safeParseArray(value: unknown): unknown[] | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}
