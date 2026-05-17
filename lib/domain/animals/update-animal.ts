/**
 * Wave 309b (ADR-0001 Wave B, #309) — domain op `updateAnimal`.
 *
 * The entire PATCH body of `app/api/animals/[id]` lifted **verbatim**:
 *   role gate (LOGGER allowlist / non-ADMIN deny)
 *   → enum validation (status, sex)
 *   → field allowlist projection
 *   → #28 cross-species parent guard (ordered, NULL-species lenient)
 *   → #98 cross-species camp guard (only when child species known)
 *   → prisma.animal.update
 *
 * Every place the legacy route did `return NextResponse.json(...)` or
 * `return routeError(...)` becomes a typed `throw` here; the route
 * adapter's try/catch routes it through `mapApiDomainError`, which
 * reproduces the legacy status + body **byte-identical** (this route
 * carries authorization — the wire shape, incl. the 403 envelope, is a
 * hard contract). The single hoisted child-species read, the parent-
 * guard loop ordering, and the legacy-NULL-species lenience are
 * preserved exactly as in the pre-extraction handler.
 *
 * `prisma.animal.findUnique` / `prisma.animal.update` are unique-key
 * ops → exempt from `audit-species-where` by construction.
 */
import type { PrismaClient } from "@prisma/client";

import { CrossSpeciesBlockedError } from "@/lib/species/errors";
import { requireSpeciesScopedCamp } from "@/lib/server/species/require-species-scoped-camp";
import type { SpeciesId } from "@/lib/species/types";

import {
  AnimalFieldForbiddenError,
  InvalidAnimalFieldError,
  ParentNotFoundError,
  SpeciesScopedCampError,
} from "./errors";

export interface UpdateAnimalInput {
  animalId: string;
  role: string;
  slug: string;
  body: Record<string, unknown>;
}

export type UpdatedAnimal = Awaited<
  ReturnType<PrismaClient["animal"]["update"]>
>;

export async function updateAnimal(
  prisma: PrismaClient,
  input: UpdateAnimalInput,
): Promise<UpdatedAnimal> {
  const { animalId: id, role, slug, body } = input;

  // LOGGER role may only update the fields needed for field logging:
  // status + deceasedAt (death recording), currentCamp (movement recording).
  const LOGGER_ALLOWED = new Set(["status", "deceasedAt", "currentCamp"]);
  if (role === "LOGGER") {
    const hasDisallowedKeys = Object.keys(body).some((k) => !LOGGER_ALLOWED.has(k));
    if (hasDisallowedKeys) {
      throw new AnimalFieldForbiddenError();
    }
  } else if (role !== "ADMIN") {
    throw new AnimalFieldForbiddenError();
  }

  const VALID_STATUS = new Set(["Active", "Deceased", "Sold", "Culled"]);
  const VALID_SEX = new Set(["Male", "Female", "Unknown"]);

  if ("status" in body && !VALID_STATUS.has(body.status as string)) {
    throw new InvalidAnimalFieldError(
      "status",
      `status must be one of: ${[...VALID_STATUS].join(", ")}`,
    );
  }
  if ("sex" in body && !VALID_SEX.has(body.sex as string)) {
    throw new InvalidAnimalFieldError(
      "sex",
      `sex must be one of: ${[...VALID_SEX].join(", ")}`,
    );
  }

  const allowed = [
    "name",
    "sex",
    "dateOfBirth",
    "breed",
    "category",
    "currentCamp",
    "status",
    "motherId",
    "fatherId",
    "registrationNumber",
    "deceasedAt",
    "tagNumber",
    "brandSequence",
  ];
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
      for (const field of parentFields) {
        const parentAnimalId = body[field] as string;
        const parent = await prisma.animal.findUnique({
          where: { animalId: parentAnimalId },
          select: { species: true },
        });
        if (!parent) {
          throw new ParentNotFoundError();
        }
        // NULL species on either side = legacy/unknown, allow with TODO.
        if (
          child?.species &&
          parent.species &&
          child.species !== parent.species
        ) {
          // Throw — the adapter routes this through `mapApiDomainError`,
          // which knows about CrossSpeciesBlockedError.
          throw new CrossSpeciesBlockedError(child.species, parent.species);
        }
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
        throw new SpeciesScopedCampError(result.reason);
      }
    }
  }

  const animal = await prisma.animal.update({
    where: { animalId: id },
    data: update,
  });

  return animal;
}
