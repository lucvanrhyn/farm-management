import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateMobWrite } from "@/lib/server/revalidate";

/**
 * Build a response payload that always includes `count` (the actual rows
 * affected) and additionally surfaces `requested` + `mismatched` whenever the
 * caller asked for more animals than were updated. This lets UIs warn the user
 * that some animals in the request were rejected (wrong species, wrong status,
 * or never existed) without breaking older callers that only read `count`.
 *
 * Wave 4 A3 (Codex adversarial review 2026-05-02 HIGH) — see
 * tasks/wave-4-a3-mobs-animals-species.md for the response-shape decision.
 */
function buildResponseBody(actualCount: number, requestedCount: number) {
  if (actualCount === requestedCount) {
    return { success: true, count: actualCount } as const;
  }
  return {
    success: true,
    count: actualCount,
    requested: requestedCount,
    mismatched: requestedCount - actualCount,
  } as const;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ mobId: string }> },
) {
  const ctx = await getFarmContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, slug, session } = ctx;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { mobId } = await params;
  const mob = await prisma.mob.findUnique({ where: { id: mobId } });
  if (!mob) {
    return NextResponse.json({ error: "Mob not found" }, { status: 404 });
  }

  const body = (await req.json()) as { animalIds: string[] };
  if (!Array.isArray(body.animalIds) || body.animalIds.length === 0) {
    return NextResponse.json(
      { error: "animalIds array is required" },
      { status: 400 },
    );
  }

  // #28 Phase B / Wave 4 A3 — hard-block cross-species mob assignment by
  // filtering on mob.species. Without this clause a sheep could be silently
  // attached to a cattle mob (Codex adversarial review 2026-05-02 HIGH).
  const { count } = await prisma.animal.updateMany({
    where: {
      animalId: { in: body.animalIds },
      status: "Active",
      species: mob.species,
    },
    data: { mobId, currentCamp: mob.currentCamp },
  });

  revalidateMobWrite(slug);

  return NextResponse.json(buildResponseBody(count, body.animalIds.length));
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ mobId: string }> },
) {
  const ctx = await getFarmContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, slug, session } = ctx;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { mobId } = await params;
  const mob = await prisma.mob.findUnique({ where: { id: mobId } });
  if (!mob) {
    return NextResponse.json({ error: "Mob not found" }, { status: 404 });
  }

  const body = (await req.json()) as { animalIds: string[] };
  if (!Array.isArray(body.animalIds) || body.animalIds.length === 0) {
    return NextResponse.json(
      { error: "animalIds array is required" },
      { status: 400 },
    );
  }

  // Defensively filter on species too — if legacy data ever pinned a
  // wrong-species animal to this mob (pre-#28), we should not silently
  // un-pin it via the wrong endpoint. Combined with the actual-count
  // response, the caller can detect the mismatch.
  const { count } = await prisma.animal.updateMany({
    where: {
      animalId: { in: body.animalIds },
      mobId,
      species: mob.species,
    },
    data: { mobId: null },
  });

  revalidateMobWrite(slug);

  return NextResponse.json(buildResponseBody(count, body.animalIds.length));
}
