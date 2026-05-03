import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { revalidateAnimalWrite } from "@/lib/server/revalidate";
import { withServerTiming, timeAsync } from "@/lib/server/server-timing";
import { logger } from "@/lib/logger";

// Pagination tunables. Default 500/request balances payload size (~100KB JSON
// for a typical cattle row) against round-trip count on large herds. Max
// 2000 caps the worst-case single-request cost when a mis-coded client asks
// for "all at once".
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

/**
 * Hotfix P0.1 (2026-05-03) — typed-error wrapper for `/api/animals` GET.
 *
 * The previous handler had NO try/catch around `prisma.animal.findMany()`.
 * Any libSQL/Prisma throw (token expiry, schema drift on a stale cached
 * client per `feedback-vercel-cached-prisma-client.md`, connection reset)
 * became a Next.js default 500 with an empty body. That cascaded into 11
 * broken admin pages + zero-animals on every per-camp logger page on prod
 * — `/admin`, `/admin/animals`, `/admin/mobs`, `/admin/observations`,
 * `/admin/breeding-ai`, `/admin/camps`, `/admin/finansies`,
 * `/tools/rotation-planner`, `/admin/animals/<id>`, `/admin/camps/<campId>`,
 * `/dashboard/camp/<campId>` — because every one of those callers branches
 * on `await res.json()` and an empty body throws SyntaxError.
 *
 * The cure (per `silent-failure-pattern.md`): catch the throw, log it
 * server-side with structured fields, and return a typed JSON envelope
 * `{ error: "DB_QUERY_FAILED", message: <underlying string> }`. Status
 * stays 500 so monitoring still flags it; the typed body lets callers
 * render a real message instead of "Something went wrong".
 *
 * Auth/validation 4xx responses pass through unchanged — they are valid
 * `NextResponse` objects and not thrown errors. We only intercept throws.
 */
function dbQueryFailed(err: unknown, route: string): NextResponse {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`[api/animals] ${route} failed`, { error: err });
  return NextResponse.json(
    { error: "DB_QUERY_FAILED", message },
    { status: 500 },
  );
}

export async function GET(req: NextRequest) {
  return withServerTiming(async () => {
    try {
      const ctx = await timeAsync("session", () => getFarmContext(req));
      if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      // instead. On a large herd this lets the client stream batches rather than
      // blocking on a single multi-MB JSON parse.
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
    } catch (err) {
      return dbQueryFailed(err, "GET");
    }
  });
}

export async function POST(req: NextRequest) {
  const ctx = await getFarmContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, slug } = ctx;
  // LOGGER role may create calf records (calving observation flow). ADMIN required for all else.
  if (role !== "ADMIN" && role !== "LOGGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { animalId, name, sex, dateOfBirth, breed, category, currentCamp, status, motherId, fatherId, species, tagNumber, brandSequence } = body;

  if (!animalId || !sex || !category || !currentCamp) {
    return NextResponse.json({ error: "Missing required fields: animalId, sex, category, currentCamp" }, { status: 400 });
  }

  // Validate field types and values
  const VALID_SPECIES = ["cattle", "sheep", "game"] as const;
  const VALID_SEX = ["Male", "Female"] as const;
  const VALID_STATUS = ["Active", "Sold", "Dead", "Removed"] as const;

  if (typeof animalId !== "string" || animalId.length > 50) {
    return NextResponse.json({ error: "Invalid animalId" }, { status: 400 });
  }
  if (!(VALID_SEX as readonly string[]).includes(sex)) {
    return NextResponse.json({ error: "Invalid sex" }, { status: 400 });
  }
  if (typeof category !== "string" || category.length > 50) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  if (species && !(VALID_SPECIES as readonly string[]).includes(species)) {
    return NextResponse.json({ error: "Invalid species" }, { status: 400 });
  }
  if (status && !(VALID_STATUS as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  if (dateOfBirth && (typeof dateOfBirth !== "string" || isNaN(Date.parse(dateOfBirth)))) {
    return NextResponse.json({ error: "Invalid dateOfBirth" }, { status: 400 });
  }

  // AIA 2002 — tagNumber + brandSequence are optional free-text fields, but
  // we cap length and reject obviously bad payloads (objects, numbers).
  if (tagNumber != null && (typeof tagNumber !== "string" || tagNumber.length > 50)) {
    return NextResponse.json({ error: "Invalid tagNumber" }, { status: 400 });
  }
  if (brandSequence != null && (typeof brandSequence !== "string" || brandSequence.length > 50)) {
    return NextResponse.json({ error: "Invalid brandSequence" }, { status: 400 });
  }

  const animal = await prisma.animal.create({
    data: {
      animalId,
      name: name ?? null,
      sex,
      dateOfBirth: dateOfBirth ?? null,
      breed: breed || undefined,
      category,
      currentCamp,
      status: status ?? "Active",
      motherId: motherId ?? null,
      fatherId: fatherId ?? null,
      species: species ?? "cattle",
      dateAdded: new Date().toISOString().split("T")[0],
      tagNumber: typeof tagNumber === "string" && tagNumber.trim() ? tagNumber.trim() : null,
      brandSequence: typeof brandSequence === "string" && brandSequence.trim() ? brandSequence.trim() : null,
    },
  });

  revalidateAnimalWrite(slug);
  return NextResponse.json({ success: true, animal }, { status: 201 });
}
