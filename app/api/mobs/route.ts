import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateMobWrite } from "@/lib/server/revalidate";
import { isValidSpecies } from "@/lib/species/registry";
import { requireSpeciesScopedCamp } from "@/lib/server/species/require-species-scoped-camp";
import type { SpeciesId } from "@/lib/species/types";

export async function GET(req: NextRequest) {
  const ctx = await getFarmContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma } = ctx;

  const [mobs, animalGroups] = await Promise.all([
    prisma.mob.findMany({ orderBy: { name: "asc" } }),
    // cross-species by design: mob list aggregates all species mob memberships.
    prisma.animal.groupBy({
      by: ["mobId"],
      where: { status: "Active", mobId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const countByMob: Record<string, number> = {};
  for (const g of animalGroups) {
    if (g.mobId) countByMob[g.mobId] = g._count._all;
  }

  const result = mobs.map((mob) => ({
    id: mob.id,
    name: mob.name,
    current_camp: mob.currentCamp,
    animal_count: countByMob[mob.id] ?? 0,
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const ctx = await getFarmContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, slug, session } = ctx;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json()) as {
    name?: string;
    currentCamp?: string;
    species?: string;
  };
  const { name, currentCamp, species } = body;

  if (!name || !currentCamp) {
    return NextResponse.json(
      { error: "name and currentCamp are required" },
      { status: 400 },
    );
  }

  // Wave 4 A2 (Codex HIGH, refs #28): require an explicit species so the
  // schema's `@default("cattle")` backstop never silently mis-classifies a
  // sheep/game mob (which would later trip the cross-species hard-block in
  // PR #60 as a confusing 422 on otherwise valid data).
  if (!species || !isValidSpecies(species)) {
    return NextResponse.json(
      { error: "species is required (cattle | sheep | game)" },
      { status: 400 },
    );
  }

  // #97 — Hard-block orphan + cross-species moves at create time.
  //
  // The previous `findFirst({ where: { campId } })` had two defects:
  //   1. Non-deterministic across duplicate campIds (Phase A of #28 made
  //      campId per-species-scoped, so the same string can exist for both
  //      cattle and sheep — without `orderBy` the picked row was a coin flip).
  //   2. Orphan camps passed through silently (a null result short-circuited
  //      the cross-species check, allowing mobs to be created against a
  //      campId that doesn't exist anywhere).
  //
  // `requireSpeciesScopedCamp` (PR #123) uses the composite-unique key
  // `(species, campId)` for a deterministic primary lookup and falls back to
  // distinguish NOT_FOUND from WRONG_SPECIES — matching the multi-species
  // hard-block spec (memory/multi-species-spec-2026-04-27.md).
  const campCheck = await requireSpeciesScopedCamp(prisma, {
    species: species as SpeciesId,
    farmSlug: slug,
    campId: currentCamp,
  });
  if (!campCheck.ok) {
    // campCheck.reason: 'NOT_FOUND' (orphan) | 'WRONG_SPECIES' (cross-species,
    // including legacy rows where camp.species is null).
    return NextResponse.json({ error: campCheck.reason }, { status: 422 });
  }

  const mob = await prisma.mob.create({
    data: { name, currentCamp, species },
  });

  revalidateMobWrite(slug);

  return NextResponse.json(
    { id: mob.id, name: mob.name, current_camp: mob.currentCamp, animal_count: 0 },
    { status: 201 },
  );
}
