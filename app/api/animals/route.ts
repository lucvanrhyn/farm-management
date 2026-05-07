import { NextResponse } from "next/server";
import { tenantRead, tenantWrite, routeError } from "@/lib/server/route";
import { revalidateAnimalWrite } from "@/lib/server/revalidate";
import { timeAsync } from "@/lib/server/server-timing";

// Pagination tunables. Default 500/request balances payload size (~100KB JSON
// for a typical cattle row) against round-trip count on large herds. Max
// 2000 caps the worst-case single-request cost when a mis-coded client asks
// for "all at once".
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

/**
 * GET /api/animals
 *
 * Hotfix P0.1 (2026-05-03) — typed-error wrapper. The previous handler had
 * NO try/catch around `prisma.animal.findMany()`. Any libSQL/Prisma throw
 * (token expiry, schema drift on a stale cached client per
 * `feedback-vercel-cached-prisma-client.md`, connection reset) became a
 * Next.js default 500 with an empty body. That cascaded into 11 broken
 * admin pages + zero-animals on every per-camp logger page on prod.
 *
 * Wave A migration moves that try/catch into the `tenantRead` adapter — any
 * throw inside `handle` produces the same typed envelope
 * `{ error: "DB_QUERY_FAILED", message }` at status 500, so the wire is
 * unchanged but every other GET in the codebase gains the same defence by
 * construction. The per-route `dbQueryFailed` helper that lived here is
 * deleted in this commit.
 */
export const GET = tenantRead({
  handle: async (ctx, req) => {
    const { prisma } = ctx;
    const { searchParams } = new URL(req.url);
    const camp = searchParams.get("camp");
    const category = searchParams.get("category");
    const status = searchParams.get("status") ?? "Active";
    const species = searchParams.get("species");
    // Phase I.2: free-text search (ID or name contains) and `unassigned=1`
    // toggle. These power the client-side "add animal to mob" picker so the
    // mobs admin page no longer SSRs the full active roster.
    const search = searchParams.get("search")?.trim() ?? "";
    const unassigned = searchParams.get("unassigned") === "1";

    // Pagination is opt-in. When neither `limit` nor `cursor` is present, the
    // handler returns the unbounded array shape so existing callers (NVD
    // picker, per-camp drill-down) don't break. The sync-manager and any
    // future bulk caller passes `?limit=` to receive `{ items, nextCursor }`
    // instead. On a large herd this lets the client stream batches rather
    // than blocking on a single multi-MB JSON parse.
    const limitParam = searchParams.get("limit");
    const cursorParam = searchParams.get("cursor");
    const paginated = limitParam !== null || cursorParam !== null;

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
      return NextResponse.json(animals);
    }

    const rawLimit = limitParam ? Number.parseInt(limitParam, 10) : DEFAULT_LIMIT;
    if (!Number.isFinite(rawLimit) || rawLimit <= 0) {
      // Pre-existing wire shape for query-param validation: `{ error: "Invalid limit" }`.
      // Kept here (NOT routed through `routeError`) because the legacy clients
      // (sync-manager) pattern-match on the message. A future wave can switch
      // this to a typed VALIDATION_FAILED envelope alongside a client-side flip.
      return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
    }
    const limit = Math.min(rawLimit, MAX_LIMIT);

    // Cursor is the last `animalId` returned in the previous batch. We order
    // ONLY by animalId when paginating (dropping the category tie-breaker) so
    // a single monotonic cursor is sufficient. Fetch `limit + 1` rows to
    // detect "has more" without a second COUNT round-trip.
    // cross-species by design: species filter is opt-in via baseWhere above.
    const items = await timeAsync("query", () =>
      prisma.animal.findMany({
        where: {
          ...baseWhere,
          ...(cursorParam ? { animalId: { gt: cursorParam } } : {}),
        },
        orderBy: { animalId: "asc" },
        take: limit + 1,
      }),
    );

    const hasMore = items.length > limit;
    const trimmed = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? trimmed[trimmed.length - 1]!.animalId : null;

    return NextResponse.json({ items: trimmed, nextCursor, hasMore });
  },
});

/**
 * POST /api/animals
 *
 * tenantWrite (not adminWrite): LOGGER role may create calf records via the
 * calving-observation flow; ADMIN may create any animal. We can't use the
 * pure adminWrite gate here, so we use tenantWrite + an in-handler role
 * guard. (When the wave-B+ domain extraction lands a `createAnimal` op,
 * the role gate moves into the domain layer.)
 */
export const POST = tenantWrite<unknown>({
  revalidate: revalidateAnimalWrite,
  handle: async (ctx, body) => {
    const { prisma, role } = ctx;
    if (role !== "ADMIN" && role !== "LOGGER") {
      return routeError("FORBIDDEN", "Forbidden", 403);
    }

    const {
      animalId,
      name,
      sex,
      dateOfBirth,
      breed,
      category,
      currentCamp,
      status,
      motherId,
      fatherId,
      species,
      tagNumber,
      brandSequence,
    } = (body ?? {}) as Record<string, unknown>;

    if (!animalId || !sex || !category || !currentCamp) {
      return NextResponse.json(
        { error: "Missing required fields: animalId, sex, category, currentCamp" },
        { status: 400 },
      );
    }

    // Validate field types and values.
    const VALID_SPECIES = ["cattle", "sheep", "game"] as const;
    const VALID_SEX = ["Male", "Female"] as const;
    const VALID_STATUS = ["Active", "Sold", "Dead", "Removed"] as const;

    if (typeof animalId !== "string" || animalId.length > 50) {
      return NextResponse.json({ error: "Invalid animalId" }, { status: 400 });
    }
    if (!(VALID_SEX as readonly string[]).includes(sex as string)) {
      return NextResponse.json({ error: "Invalid sex" }, { status: 400 });
    }
    if (typeof category !== "string" || category.length > 50) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }
    if (species && !(VALID_SPECIES as readonly string[]).includes(species as string)) {
      return NextResponse.json({ error: "Invalid species" }, { status: 400 });
    }
    if (status && !(VALID_STATUS as readonly string[]).includes(status as string)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    if (
      dateOfBirth &&
      (typeof dateOfBirth !== "string" || isNaN(Date.parse(dateOfBirth as string)))
    ) {
      return NextResponse.json({ error: "Invalid dateOfBirth" }, { status: 400 });
    }

    // AIA 2002 — tagNumber + brandSequence are optional free-text fields, but
    // we cap length and reject obviously bad payloads (objects, numbers).
    if (
      tagNumber != null &&
      (typeof tagNumber !== "string" || (tagNumber as string).length > 50)
    ) {
      return NextResponse.json({ error: "Invalid tagNumber" }, { status: 400 });
    }
    if (
      brandSequence != null &&
      (typeof brandSequence !== "string" || (brandSequence as string).length > 50)
    ) {
      return NextResponse.json({ error: "Invalid brandSequence" }, { status: 400 });
    }

    const animal = await prisma.animal.create({
      data: {
        animalId: animalId as string,
        name: (name as string | undefined) ?? null,
        sex: sex as string,
        dateOfBirth: (dateOfBirth as string | undefined) ?? null,
        breed: (breed as string | undefined) || undefined,
        category: category as string,
        currentCamp: currentCamp as string,
        status: (status as string | undefined) ?? "Active",
        motherId: (motherId as string | undefined) ?? null,
        fatherId: (fatherId as string | undefined) ?? null,
        species: (species as string | undefined) ?? "cattle",
        dateAdded: new Date().toISOString().split("T")[0],
        tagNumber:
          typeof tagNumber === "string" && tagNumber.trim()
            ? tagNumber.trim()
            : null,
        brandSequence:
          typeof brandSequence === "string" && brandSequence.trim()
            ? brandSequence.trim()
            : null,
      },
    });

    return NextResponse.json({ success: true, animal }, { status: 201 });
  },
});
