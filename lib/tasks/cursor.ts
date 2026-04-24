/**
 * lib/tasks/cursor.ts
 *
 * Opaque composite-cursor helper for Task pagination.
 *
 * Task rows sort by `[dueDate, createdAt, id]`. A single scalar cursor (e.g.
 * just `id`) would break whenever two tasks share the same `dueDate`, which
 * is common because Phase K's recurrence engine materialises many tasks on
 * the same day. The composite cursor carries enough information to build a
 * strict-greater-than "tuple" WHERE clause so the next page always starts at
 * the row immediately after the last row of the previous page, even across
 * ties.
 *
 * Encoding: base64url(JSON.stringify({ dueDate, createdAt, id })). This is
 * opaque to clients — they round-trip whatever string the server returned.
 */

export interface TaskCursor {
  /** ISO date string — the Task.dueDate column is `String`. */
  dueDate: string;
  /** ISO-8601 timestamp — Task.createdAt serialised to UTC string. */
  createdAt: string;
  /** Task.id (cuid). */
  id: string;
}

export const TASK_CURSOR_ORDER_BY = [
  { dueDate: "asc" as const },
  { createdAt: "asc" as const },
  { id: "asc" as const },
];

export function encodeTaskCursor(c: TaskCursor): string {
  return Buffer.from(JSON.stringify(c), "utf-8").toString("base64url");
}

export function decodeTaskCursor(raw: string): TaskCursor | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf-8");
    const parsed = JSON.parse(json) as Partial<TaskCursor>;
    if (
      typeof parsed.dueDate === "string" &&
      typeof parsed.createdAt === "string" &&
      typeof parsed.id === "string" &&
      parsed.dueDate.length > 0 &&
      parsed.createdAt.length > 0 &&
      parsed.id.length > 0
    ) {
      return { dueDate: parsed.dueDate, createdAt: parsed.createdAt, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Translate a cursor into a Prisma "tuple strict greater-than" WHERE clause:
 *
 *   (dueDate > d)
 *   OR (dueDate = d AND createdAt > c)
 *   OR (dueDate = d AND createdAt = c AND id > i)
 *
 * Combined with `orderBy: TASK_CURSOR_ORDER_BY`, this yields a total order
 * over Task rows that is stable across ties.
 */
export function tupleGtWhere(cursor: TaskCursor): Record<string, unknown> {
  const createdAt = new Date(cursor.createdAt);
  return {
    OR: [
      { dueDate: { gt: cursor.dueDate } },
      { dueDate: cursor.dueDate, createdAt: { gt: createdAt } },
      { dueDate: cursor.dueDate, createdAt, id: { gt: cursor.id } },
    ],
  };
}
