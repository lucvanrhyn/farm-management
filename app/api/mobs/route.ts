import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateMobWrite } from "@/lib/server/revalidate";
import { isValidSpecies } from "@/lib/species/registry";
import { CROSS_SPECIES_BLOCKED } from "@/lib/server/mob-move";

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

  // Cross-species hard-block at create time. Mirrors the PATCH guard inside
  // performMobMove so the W4 A10 error-mapper helper sees one consistent
  // contract regardless of entry point. campId is per-species scoped, so a
  // species-aware findFirst returns the matching row when the camp belongs
  // to this species. If no row matches but a different-species row exists
  // for the same campId, we surface 422 — the spec
  // (memory/multi-species-spec-2026-04-27.md) treats that as a cross-species
  // attempt.
  const destCamp = await prisma.camp.findFirst({
    where: { campId: currentCamp },
    select: { species: true },
  });
  if (destCamp && destCamp.species !== species) {
    return NextResponse.json({ error: CROSS_SPECIES_BLOCKED }, { status: 422 });
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
