/**
 * Wave E (#161) — domain ops `listTasksUnbounded`, `listTasksPaginated`,
 * `listTaskOccurrences`.
 *
 * Three exported functions keep the route's three GET modes type-safe at
 * the call site. The route adapter inspects search params, picks one of
 * the three, and the corresponding op owns the Prisma query + filter
 * translation + pagination cursor logic.
 *
 * Wire shape preserves the legacy "parsed arrays" return — the DB stores
 * `assigneeIds` and `blockedByIds` as JSON-stringified arrays, but
 * consumers (admin /tasks UI, IndexedDB sync, logger) expect proper
 * `string[] | null` on the wire. The `parseTaskArrayFields` helper here
 * is the single owner of that translation.
 *
 * Pagination tunables (`DEFAULT_LIMIT` / `MAX_LIMIT`) are preserved from
 * the pre-Wave-E `app/api/tasks/route.ts` constants — admin /tasks SSR
 * page-size is 50, hard-cap is 500.
 */
import type { PrismaClient } from "@prisma/client";

import {
  decodeTaskCursor,
  encodeTaskCursor,
  TASK_CURSOR_ORDER_BY,
  tupleGtWhere,
} from "@/lib/tasks/cursor";

import { InvalidCursorError, InvalidLimitError } from "./errors";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ListTasksFilters {
  assignee?: string | null;
  /** Comma-separated list — split inside the op into a Prisma `in` clause. */
  status?: string | null;
  /** Filter by exact `dueDate` string (YYYY-MM-DD). */
  date?: string | null;
  campId?: string | null;
  taskType?: string | null;
  /** Bounding-box filter (small-angle approximation). */
  geo?: { lat: number; lng: number; radiusKm: number } | null;
}

export interface ListTasksPaginatedArgs {
  filters: ListTasksFilters;
  limit: number;
  cursor?: string | null;
}

export interface ListTasksPaginatedResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tasks: Array<Record<string, any>>;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ListTaskOccurrencesArgs {
  from: Date;
  to: Date;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Max tasks per single paginated request — caps single-request cost. */
export const MAX_LIMIT = 500;

// ── Helpers (single owner of array-field parsing) ────────────────────────────

/**
 * Parse `assigneeIds` and `blockedByIds` from JSON strings to arrays
 * before returning to the client, so the API contract returns proper
 * arrays.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseTaskArrayFields(task: Record<string, any>): Record<string, any> {
  return {
    ...task,
    assigneeIds: safeParseArray(task.assigneeIds),
    blockedByIds: safeParseArray(task.blockedByIds),
  };
}

export function safeParseArray(value: unknown): unknown[] | null {
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

// ── Where-clause builder (shared between unbounded + paginated) ──────────────

function buildWhere(filters: ListTasksFilters): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {};

  if (filters.assignee) where.assignedTo = filters.assignee;

  if (filters.status) {
    const statuses = filters.status
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
  }

  if (filters.date) where.dueDate = filters.date;
  if (filters.campId) where.campId = filters.campId;
  if (filters.taskType) where.taskType = filters.taskType;

  // Bounding-box geo filter — small-angle approximation. 1 degree latitude
  // ≈ 111 km; longitude varies by cos(lat) but we use lat as an
  // approximation (acceptable error < 5% within SA at ~30°S).
  if (filters.geo) {
    const { lat, lng, radiusKm } = filters.geo;
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Number.isFinite(radiusKm) &&
      radiusKm > 0
    ) {
      const deltaLat = radiusKm / 111;
      const deltaLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
      where.lat = { gte: lat - deltaLat, lte: lat + deltaLat };
      where.lng = { gte: lng - deltaLng, lte: lng + deltaLng };
    }
  }

  return where;
}

// ── Ops ──────────────────────────────────────────────────────────────────────

/**
 * Unbounded list — back-compat shape used by IndexedDB sync + logger
 * fetch. Returns the entire match set; only safe under tenant-scoped
 * Prisma where the row count is naturally bounded per farm.
 */
export async function listTasksUnbounded(
  prisma: PrismaClient,
  filters: ListTasksFilters,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Array<Record<string, any>>> {
  const where = buildWhere(filters);
  const tasks = await prisma.task.findMany({
    where,
    orderBy: [{ dueDate: "asc" }, { priority: "asc" }, { createdAt: "asc" }],
  });
  return tasks.map(parseTaskArrayFields);
}

/**
 * Paginated list — `{ tasks, nextCursor, hasMore }` shape used by the
 * admin /tasks SSR page + "Load more" control. Stable composite cursor
 * `[dueDate, createdAt, id]` so ties at a shared dueDate don't drop rows
 * across page boundaries.
 *
 * Throws `InvalidLimitError` if `limit ≤ 0` / NaN; `InvalidCursorError`
 * if cursor decode fails.
 */
export async function listTasksPaginated(
  prisma: PrismaClient,
  args: ListTasksPaginatedArgs,
): Promise<ListTasksPaginatedResult> {
  const { filters, cursor } = args;
  const rawLimit = args.limit;

  if (!Number.isFinite(rawLimit) || rawLimit <= 0) {
    throw new InvalidLimitError(String(rawLimit));
  }
  const limit = Math.min(rawLimit, MAX_LIMIT);

  let cursorWhere: Record<string, unknown> | null = null;
  if (cursor) {
    const decoded = decodeTaskCursor(cursor);
    if (!decoded) {
      throw new InvalidCursorError(cursor);
    }
    cursorWhere = tupleGtWhere(decoded);
  }

  const where = { ...buildWhere(filters), ...(cursorWhere ?? {}) };

  // Fetch `limit + 1` rows to detect "has more" without a COUNT round-trip.
  const items = await prisma.task.findMany({
    where,
    orderBy: TASK_CURSOR_ORDER_BY,
    take: limit + 1,
  });

  const hasMore = items.length > limit;
  const trimmed = hasMore ? items.slice(0, limit) : items;
  const last = trimmed[trimmed.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeTaskCursor({
          dueDate: last.dueDate,
          createdAt: last.createdAt.toISOString(),
          id: last.id,
        })
      : null;

  return {
    tasks: trimmed.map(parseTaskArrayFields),
    nextCursor,
    hasMore,
  };
}

/**
 * Task occurrences in a window — Phase K recurrence-engine output
 * surfaced to the dashboard "today" view. Matches pre-Wave-E
 * `as=occurrences` mode verbatim.
 */
export async function listTaskOccurrences(
  prisma: PrismaClient,
  args: ListTaskOccurrencesArgs,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Array<Record<string, any>>> {
  const { from, to } = args;
  return prisma.taskOccurrence.findMany({
    where: { occurrenceAt: { gte: from, lte: to } },
    include: { task: true },
    orderBy: { occurrenceAt: "asc" },
  });
}
