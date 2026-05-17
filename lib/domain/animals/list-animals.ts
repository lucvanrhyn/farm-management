/**
 * Wave 316b (ADR-0001 Wave B, #309) — domain op `listAnimals`.
 *
 * The fat GET body of `app/api/animals` lifted verbatim: `baseWhere`
 * construction from the parsed filter params, the unbounded vs cursor
 * `prisma.animal.findMany` split, and the `hasMore`/`nextCursor`
 * computation. The route becomes a thin adapter that parses query params
 * (incl. the `{ error: "Invalid limit" }` 400 — kept at the boundary, see
 * below) and maps the discriminated result back to the byte-identical
 * legacy wire.
 *
 * Behaviour-preserving. The op returns a JSON-serialisable discriminated
 * union; the discriminator NEVER reaches the wire — the route maps:
 *   `{ mode: "all",  animals }`               → `NextResponse.json(animals)`
 *                                                (bare array — UNCHANGED)
 *   `{ mode: "page", items, nextCursor, hasMore }`
 *                                → `NextResponse.json({ items, nextCursor,
 *                                                       hasMore })`
 *
 * `limit` validation stays in the route adapter (boundary parsing — same
 * rationale 316a kept `createCampSchema` in the route). The op receives an
 * already-clamped numeric `limit`; it does NOT own the `"Invalid limit"`
 * literal (legacy sync-manager clients pattern-match it; migrating it to a
 * typed envelope is a deferred future wave, out of scope here).
 *
 * The `timeAsync("query", ...)` perf-telemetry wrapper moves INTO the op so
 * the Server-Timing contract is preserved regardless of caller.
 */
import type { PrismaClient } from "@prisma/client";

import { timeAsync } from "@/lib/server/server-timing";

/**
 * Already-parsed filter inputs from the route adapter. `paginated` is the
 * route's `limitParam !== null || cursorParam !== null` discriminator,
 * computed exactly as before. When `paginated` is true the route has
 * already validated + clamped `limit` to a positive integer.
 */
export interface ListAnimalsQuery {
  camp?: string | null;
  category?: string | null;
  status: string;
  species?: string | null;
  search?: string;
  unassigned?: boolean;
  paginated: boolean;
  limit?: number;
  cursor?: string | null;
}

type AnimalRows = Awaited<ReturnType<PrismaClient["animal"]["findMany"]>>;

export type ListAnimalsResult =
  | { mode: "all"; animals: AnimalRows }
  | {
      mode: "page";
      items: AnimalRows;
      nextCursor: string | null;
      hasMore: boolean;
    };

export async function listAnimals(
  prisma: PrismaClient,
  query: ListAnimalsQuery,
): Promise<ListAnimalsResult> {
  const {
    camp,
    category,
    status,
    species,
    search = "",
    unassigned = false,
    paginated,
    cursor,
  } = query;

  const baseWhere = {
    ...(camp ? { currentCamp: camp } : {}),
    ...(category ? { category } : {}),
    ...(status !== "all" ? { status } : {}),
    ...(species ? { species } : {}),
    ...(unassigned ? { mobId: null } : {}),
    ...(search
      ? {
          OR: [
            { animalId: { contains: search } },
            { name: { contains: search } },
          ],
        }
      : {}),
  };

  if (!paginated) {
    // cross-species by design: species filter is opt-in via `?species=`
    // (see baseWhere construction above). Callers that want a single
    // species pass it explicitly; legacy callers stay multi-species.
    const animals = await timeAsync("query", () =>
      prisma.animal.findMany({
        where: baseWhere,
        orderBy: [{ category: "asc" }, { animalId: "asc" }],
      }),
    );
    return { mode: "all", animals };
  }

  const limit = query.limit!;

  // Cursor is the last `animalId` returned in the previous batch. We order
  // ONLY by animalId when paginating (dropping the category tie-breaker) so
  // a single monotonic cursor is sufficient. Fetch `limit + 1` rows to
  // detect "has more" without a second COUNT round-trip.
  // cross-species by design: species filter is opt-in via baseWhere above.
  const items = await timeAsync("query", () =>
    prisma.animal.findMany({
      where: {
        ...baseWhere,
        ...(cursor ? { animalId: { gt: cursor } } : {}),
      },
      orderBy: { animalId: "asc" },
      take: limit + 1,
    }),
  );

  const hasMore = items.length > limit;
  const trimmed = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? trimmed[trimmed.length - 1]!.animalId : null;

  return { mode: "page", items: trimmed, nextCursor, hasMore };
}
