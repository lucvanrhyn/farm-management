import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { revalidateAnimalWrite } from "@/lib/server/revalidate";
import { withServerTiming, timeAsync } from "@/lib/server/server-timing";

// Pagination tunables. Default 500/request balances payload size (~100KB JSON
// for a typical cattle row) against round-trip count on large herds. Max
// 2000 caps the worst-case single-request cost when a mis-coded client asks
// for "all at once".
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

export async function GET(req: NextRequest) {
  return withServerTiming(async () => {
    const ctx = await timeAsync("session", () => getFarmContext(req));
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { prisma } = ctx;

    const { searchParams } = new URL(req.url);
    const camp = searchParams.get("camp");
    const category = searchParams.get("category");
    const status = searchParams.get("status") ?? "Active";
    const species = searchParams.get("species");

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
    };

    if (!paginated) {
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
  const { animalId, name, sex, dateOfBirth, breed, category, currentCamp, status, motherId, fatherId, species } = body;

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
    },
  });

  revalidateAnimalWrite(slug);
  return NextResponse.json({ success: true, animal }, { status: 201 });
}
