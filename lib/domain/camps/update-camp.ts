/**
 * Wave 309a (ADR-0001 Wave B, #309) — domain op `updateCamp`.
 *
 * Pure business logic extracted from `app/api/camps/[campId]` PATCH.
 * Validation already happened in the route's `patchCampSchema` adapter
 * parse; this op accepts the already-parsed patch and persists it.
 *
 * Throws `CampNotFoundError` (canonical `CAMP_NOT_FOUND` 404) when the
 * camp does not exist.
 */
import type { PrismaClient } from "@prisma/client";

import { CampNotFoundError } from "@/lib/domain/observations/errors";

/**
 * The already-validated optional-field patch (mirrors the route's
 * `PatchCampBody`). Only keys present here are written; an explicit
 * `null` clears the column, `undefined`/absent leaves it untouched.
 */
export interface PatchCampBody {
  campName?: string;
  sizeHectares?: number | null;
  waterSource?: string | null;
  geojson?: string | null;
  color?: string | null;
  veldType?: string | null;
  restDaysOverride?: number | null;
  maxGrazingDaysOverride?: number | null;
  rotationNotes?: string | null;
}

export interface UpdateCampInput {
  campId: string;
  patch: PatchCampBody;
}

export interface UpdateCampResult {
  success: true;
}

export async function updateCamp(
  prisma: PrismaClient,
  input: UpdateCampInput,
): Promise<UpdateCampResult> {
  const { campId, patch } = input;

  // Phase A of #28: campId is no longer globally unique (composite UNIQUE
  // on species+campId). findFirst is single-species-safe; Phase B will
  // scope by species and use the compound key.
  const camp = await prisma.camp.findFirst({ where: { campId } });
  if (!camp) {
    throw new CampNotFoundError(campId);
  }

  // Phase A of #28: campId is no longer globally unique. Update via the
  // CUID primary key resolved above; Phase B will switch to the compound
  // key once the API layer carries a `species` discriminator.
  await prisma.camp.update({
    where: { id: camp.id },
    data: {
      ...(patch.campName !== undefined && { campName: patch.campName }),
      ...(patch.sizeHectares !== undefined && {
        sizeHectares: patch.sizeHectares,
      }),
      ...(patch.waterSource !== undefined && {
        waterSource: patch.waterSource,
      }),
      ...(patch.geojson !== undefined && { geojson: patch.geojson }),
      ...(patch.color !== undefined && { color: patch.color }),
      ...(patch.veldType !== undefined && { veldType: patch.veldType }),
      ...(patch.restDaysOverride !== undefined && {
        restDaysOverride: patch.restDaysOverride,
      }),
      ...(patch.maxGrazingDaysOverride !== undefined && {
        maxGrazingDaysOverride: patch.maxGrazingDaysOverride,
      }),
      ...(patch.rotationNotes !== undefined && {
        rotationNotes: patch.rotationNotes,
      }),
    },
  });

  return { success: true };
}
