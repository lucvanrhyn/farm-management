import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { CrossSpeciesBlockedError } from "@/lib/server/mob-move";
import { mapApiDomainError } from "@/lib/server/api-errors";
import { revalidateAnimalWrite } from "@/lib/server/revalidate";
import { requireSpeciesScopedCamp } from "@/lib/server/species/require-species-scoped-camp";
import type { SpeciesId } from "@/lib/species/types";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {

  const ctx = await getFarmContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma } = ctx;

  const { id } = await params;

  const animal = await prisma.animal.findUnique({
    where: { animalId: id },
  });

  if (!animal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(animal);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {

  const ctx = await getFarmContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, slug } = ctx;

  const { id } = await params;
  const body = await req.json() as Record<string, unknown>;

  // LOGGER role may only update the fields needed for field logging:
  // status + deceasedAt (death recording), currentCamp (movement recording).
  const LOGGER_ALLOWED = new Set(["status", "deceasedAt", "currentCamp"]);
  if (role === "LOGGER") {
    const hasDisallowedKeys = Object.keys(body).some((k) => !LOGGER_ALLOWED.has(k));
    if (hasDisallowedKeys) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else if (role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const VALID_STATUS = new Set(["Active", "Deceased", "Sold", "Culled"]);
  const VALID_SEX = new Set(["Male", "Female", "Unknown"]);

  if ("status" in body && !VALID_STATUS.has(body.status as string)) {
    return NextResponse.json({ error: `status must be one of: ${[...VALID_STATUS].join(", ")}` }, { status: 400 });
  }
  if ("sex" in body && !VALID_SEX.has(body.sex as string)) {
    return NextResponse.json({ error: `sex must be one of: ${[...VALID_SEX].join(", ")}` }, { status: 400 });
  }

  const allowed = ["name", "sex", "dateOfBirth", "breed", "category", "currentCamp", "status", "motherId", "fatherId", "registrationNumber", "deceasedAt", "tagNumber", "brandSequence"];
  const update: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }

  // #28 Phase B — cross-species parent guard. If the patch sets motherId or
  // fatherId, the parent must (a) exist and (b) share the child's species.
  // #98 — cross-species camp guard. If the patch sets currentCamp, the
  // destination camp must (a) exist and (b) share the child's species.
  // Edge case: NULL species on the child (legacy data) is treated as
  // "unknown, allow" with a TODO so legacy tenants don't break in prod.
  // TODO(#28): tighten once species backfill is verified across all tenants.
  const parentFields: Array<"motherId" | "fatherId"> = [];
  if ("motherId" in body && body.motherId) parentFields.push("motherId");
  if ("fatherId" in body && body.fatherId) parentFields.push("fatherId");
  const hasCampMove = "currentCamp" in body && Boolean(body.currentCamp);

  // Hoisted child-species lookup: shared between parent-guard and camp-guard
  // so we issue exactly one read regardless of how many guards must run.
  if (parentFields.length > 0 || hasCampMove) {
    const child = await prisma.animal.findUnique({
      where: { animalId: id },
      select: { species: true },
    });

    if (parentFields.length > 0) {
      try {
        for (const field of parentFields) {
          const parentAnimalId = body[field] as string;
          const parent = await prisma.animal.findUnique({
            where: { animalId: parentAnimalId },
            select: { species: true },
          });
          if (!parent) {
            return NextResponse.json({ error: "PARENT_NOT_FOUND" }, { status: 422 });
          }
          // NULL species on either side = legacy/unknown, allow with TODO.
          if (child?.species && parent.species && child.species !== parent.species) {
            throw new CrossSpeciesBlockedError(child.species, parent.species);
          }
        }
      } catch (err) {
        const mapped = mapApiDomainError(err);
        if (mapped) return mapped;
        throw err;
      }
    }

    // Camp-guard runs only when the child species is known. Legacy rows with
    // species=null are allowed through, mirroring the parent-guard lenience.
    // TODO(#28): tighten once species backfill is verified across all tenants.
    if (hasCampMove && child?.species) {
      const result = await requireSpeciesScopedCamp(prisma, {
        species: child.species as SpeciesId,
        farmSlug: slug,
        campId: body.currentCamp as string,
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.reason }, { status: 422 });
      }
    }
  }

  const animal = await prisma.animal.update({
    where: { animalId: id },
    data: update,
  });

  revalidateAnimalWrite(slug);
  return NextResponse.json(animal);
}
