/**
 * Wave 309a (ADR-0001 Wave B, #309) — domain op `deleteCamp`.
 *
 * Pure business logic extracted from `app/api/camps/[campId]` DELETE.
 * Hard-blocks deletion of a camp that still has active animals referencing
 * it. Throws `CampNotFoundError` (canonical `CAMP_NOT_FOUND` 404) when the
 * camp does not exist; throws `CampHasActiveAnimalsError` (409 with the
 * count-bearing legacy message) when the active-animal guard fails.
 */
import type { PrismaClient } from "@prisma/client";

import { CampNotFoundError } from "@/lib/domain/observations/errors";

import { CampHasActiveAnimalsError } from "./errors";

export interface DeleteCampResult {
  success: true;
}

export async function deleteCamp(
  prisma: PrismaClient,
  campId: string,
): Promise<DeleteCampResult> {
  // Phase A of #28: campId is no longer globally unique (composite UNIQUE
  // on species+campId). findFirst is single-species-safe; Phase B will
  // scope.
  const camp = await prisma.camp.findFirst({ where: { campId } });
  if (!camp) {
    throw new CampNotFoundError(campId);
  }

  // cross-species by design: deletion guard must block on any species in
  // camp.
  const activeAnimals = await prisma.animal.count({
    where: { currentCamp: campId, status: "Active" },
  });
  if (activeAnimals > 0) {
    throw new CampHasActiveAnimalsError(activeAnimals);
  }

  // Phase A of #28: delete via the resolved CUID primary key (campId is no
  // longer globally unique). Phase B will switch to the compound key.
  await prisma.camp.delete({ where: { id: camp.id } });

  return { success: true };
}
