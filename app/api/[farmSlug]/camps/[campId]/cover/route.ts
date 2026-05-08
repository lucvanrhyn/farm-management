/**
 * GET    /api/[farmSlug]/camps/[campId]/cover — list cover readings + days-remaining math.
 * POST   /api/[farmSlug]/camps/[campId]/cover — record a cover reading (ADMIN, fresh-admin re-verified).
 * DELETE /api/[farmSlug]/camps/[campId]/cover — delete a cover reading by `readingId` body field
 *                                                (ADMIN, fresh-admin re-verified).
 *
 * Wave G6 (#170) — migrated onto `tenantReadSlug` / `tenantWriteSlug`.
 *
 * Wire-shape preservation (hybrid per ADR-0001 / Wave G6 spec):
 *   - 200/201 success shapes unchanged.
 *   - 401 envelope migrates to the adapter's canonical
 *     `{ error: "AUTH_REQUIRED", message: "..." }`.
 *   - 403 (non-admin / stale-admin), 400 (validation), 404 (not-found) keep
 *     their bare-string `{ error: "<sentence>" }` envelopes.
 *   - Phase H.2 defence-in-depth `verifyFreshAdminRole(ctx.session.user.id, ctx.slug)`
 *     stays inline (variant signature differs from G5 routes — preserved verbatim).
 *
 * Cover-readings math (`CATEGORY_KG_DM`, `DEFAULT_USE_FACTOR`,
 * `DAILY_DMI_PER_HEAD`, `calcDaysRemaining`) is camp-cover-specific and
 * stays inline — no domain extraction this wave.
 */
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { tenantReadSlug, tenantWriteSlug } from "@/lib/server/route";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateCampWrite } from "@/lib/server/revalidate";
import type { FarmContext } from "@/lib/server/farm-context";

export const dynamic = "force-dynamic";

// kg DM/ha midpoints for each category (SA bushveld/Highveld ranges)
const CATEGORY_KG_DM: Record<string, number> = {
  Good: 2000, // 1,500–2,500 kg DM/ha
  Fair: 1100, // 700–1,500 kg DM/ha
  Poor: 450, // 200–700 kg DM/ha
};

// Default SA use factor: 35% of standing biomass consumed before animals move
const DEFAULT_USE_FACTOR = 0.35;

// Daily DMI per animal: 10 kg DM/LSU/day (SA DALRRD official standard)
const DAILY_DMI_PER_HEAD = 10;

function calcDaysRemaining(
  kgDmPerHa: number,
  sizeHectares: number,
  animalCount: number,
  useFactor: number,
): number | null {
  if (animalCount <= 0 || sizeHectares <= 0 || kgDmPerHa <= 0) return null;
  return Math.round((kgDmPerHa * sizeHectares * useFactor) / (animalCount * DAILY_DMI_PER_HEAD));
}

/**
 * Phase H.2 fresh-admin gate — common to every write method on this route.
 * Returns a 403 NextResponse on failure; null on success.
 */
async function denyIfNotFreshAdmin(ctx: FarmContext): Promise<NextResponse | null> {
  if (ctx.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  if (!(await verifyFreshAdminRole(ctx.session.user.id, ctx.slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export const GET = tenantReadSlug<{ farmSlug: string; campId: string }>({
  handle: async (ctx, _req, { campId }) => {
    // Fire all three independent queries in parallel (~3 Turso round-trips → 1)
    const [readings, camp, animalCount] = await Promise.all([
      ctx.prisma.campCoverReading.findMany({
        where: { campId },
        orderBy: { recordedAt: "desc" },
        take: 30,
      }),
      // Phase A of #28: campId is no longer globally unique. findFirst is
      // single-species-safe; Phase B will scope by species.
      ctx.prisma.camp.findFirst({
        where: { campId },
        select: { sizeHectares: true },
      }),
      // cross-species by design: cover/days-remaining math counts every animal
      // grazing the camp regardless of species (LSU is computed elsewhere).
      ctx.prisma.animal.count({
        where: { currentCamp: campId, status: "Active" },
      }),
    ]);

    const latest = readings[0] ?? null;
    const daysRemaining =
      latest && camp?.sizeHectares
        ? calcDaysRemaining(latest.kgDmPerHa, camp.sizeHectares, animalCount, latest.useFactor)
        : null;

    return NextResponse.json({
      readings,
      latest,
      daysRemaining,
      animalCount,
      sizeHectares: camp?.sizeHectares ?? null,
      meta: {
        categoryKgDm: CATEGORY_KG_DM,
        useFactor: DEFAULT_USE_FACTOR,
        dailyDmiPerHead: DAILY_DMI_PER_HEAD,
      },
    });
  },
});

export const POST = tenantWriteSlug<unknown, { farmSlug: string; campId: string }>({
  revalidate: revalidateCampWrite,
  handle: async (ctx, body, _req, { campId }) => {
    const denied = await denyIfNotFreshAdmin(ctx);
    if (denied) return denied;

    const { coverCategory, kgDmPerHaOverride } = (body ?? {}) as {
      coverCategory?: unknown;
      kgDmPerHaOverride?: unknown;
    };

    if (
      typeof coverCategory !== "string" ||
      !["Good", "Fair", "Poor"].includes(coverCategory)
    ) {
      return NextResponse.json(
        { error: "coverCategory must be Good, Fair, or Poor" },
        { status: 400 },
      );
    }

    const kgDmPerHa =
      typeof kgDmPerHaOverride === "number" && kgDmPerHaOverride > 0
        ? kgDmPerHaOverride
        : CATEGORY_KG_DM[coverCategory];

    // Fetch camp and animal count in parallel (both needed before the create)
    const [camp, animalCount] = await Promise.all([
      // Phase A of #28: campId is no longer globally unique. findFirst is
      // single-species-safe; Phase B will scope by species.
      ctx.prisma.camp.findFirst({
        where: { campId },
        select: { sizeHectares: true },
      }),
      // cross-species by design: cover/days-remaining math counts every animal
      // grazing the camp regardless of species (LSU is computed elsewhere).
      ctx.prisma.animal.count({
        where: { currentCamp: campId, status: "Active" },
      }),
    ]);
    if (!camp) return NextResponse.json({ error: "Camp not found" }, { status: 404 });

    const reading = await ctx.prisma.campCoverReading.create({
      data: {
        id: randomUUID(),
        campId,
        coverCategory,
        kgDmPerHa,
        useFactor: DEFAULT_USE_FACTOR,
        recordedAt: new Date().toISOString(),
        recordedBy: ctx.session.user?.email ?? "Unknown",
      },
    });

    const daysRemaining = camp.sizeHectares
      ? calcDaysRemaining(kgDmPerHa, camp.sizeHectares, animalCount, DEFAULT_USE_FACTOR)
      : null;

    return NextResponse.json({ reading, daysRemaining }, { status: 201 });
  },
});

export const DELETE = tenantWriteSlug<unknown, { farmSlug: string; campId: string }>({
  revalidate: revalidateCampWrite,
  handle: async (ctx, body) => {
    const denied = await denyIfNotFreshAdmin(ctx);
    if (denied) return denied;

    const { readingId } = (body ?? {}) as { readingId?: unknown };
    if (!readingId || typeof readingId !== "string") {
      return NextResponse.json({ error: "readingId is required" }, { status: 400 });
    }

    await ctx.prisma.campCoverReading.delete({ where: { id: readingId } });
    return NextResponse.json({ ok: true });
  },
});
