/**
 * Wave 316a (ADR-0001 Wave B, #309) — domain op `createCamp`.
 *
 * Pure business logic extracted from `app/api/camps` POST. Validation
 * already happened in the route's `createCampSchema` adapter parse; this
 * op accepts the already-parsed `CreateCampBody` (including the
 * `SPECIES_OMITTED` sentinel) and persists it.
 *
 * Owns the single source of truth for the `SPECIES_OMITTED` sentinel
 * string — the route imports it for its schema parse so the literal is
 * never duplicated.
 *
 * Throws `MissingSpeciesError` (mapped 422 `{ error: "MISSING_SPECIES" }`,
 * issue #232) when species was omitted; `DuplicateCampError` (mapped 409
 * with the byte-identical legacy message) when the species-scoped
 * duplicate guard fails.
 */
import type { PrismaClient } from "@prisma/client";

import { CAMP_COLOR_PALETTE } from "@/lib/camp-colors";
import { scoped } from "@/lib/server/species-scoped-prisma";
import type { SpeciesId } from "@/lib/species/types";

import { DuplicateCampError, MissingSpeciesError } from "./errors";

/**
 * Sentinel used by the route's `createCampSchema` to mark "species was
 * omitted entirely" — `createCamp` converts this into the typed 422
 * MISSING_SPECIES failure required by issue #232 (no silent inherit from
 * the Prisma column default). Schema-level VALIDATION_FAILED would 400
 * with `details.fieldErrors.species` — distinct from this 422, which
 * signals the user simply forgot to choose.
 */
export const SPECIES_OMITTED = "__species_omitted__" as const;

/**
 * The already-validated create body (mirrors the route's
 * `CreateCampBody`). `species` carries the parsed value or the
 * `SPECIES_OMITTED` sentinel.
 */
export interface CreateCampInput {
  campId: string;
  campName: string;
  species: SpeciesId | typeof SPECIES_OMITTED;
  sizeHectares?: number | string | null;
  waterSource?: string | null;
  geojson?: string | null;
  color?: string | null;
}

export interface CreateCampResult {
  camp_id: string;
  camp_name: string;
  size_hectares: number | null;
  water_source: string | null;
  geojson: string | null;
  color: string | null;
  animal_count: 0;
}

export async function createCamp(
  prisma: PrismaClient,
  input: CreateCampInput,
): Promise<CreateCampResult> {
  const { campId, campName, species, sizeHectares, waterSource, geojson, color } =
    input;

  // Issue #232 — typed 422 when species was omitted. Distinct from schema
  // VALIDATION_FAILED (400) so clients can render "please pick a species"
  // UX without parsing the field-errors bag.
  if ((species as string) === SPECIES_OMITTED) {
    throw new MissingSpeciesError();
  }

  // After the SPECIES_OMITTED guard above, `species` is a real SpeciesId. TS
  // can't narrow the branded sentinel out of the union, so cast explicitly.
  const speciesId = species as SpeciesId;

  // Phase A of #28: campId is no longer globally unique (composite UNIQUE on
  // species+campId). The duplicate check MUST be species-scoped so the same
  // campId can exist across species (cattle's NORTH-01 vs sheep's NORTH-01
  // are distinct rows). The species-scoped facade injects `species: speciesId`
  // — identical to the previously-explicit `species` key, so the now-redundant
  // literal is dropped.
  const existing = await scoped(prisma, speciesId).camp.findFirst({
    where: { campId },
  });
  if (existing) {
    throw new DuplicateCampError();
  }

  // Auto-assign a color from the palette if not provided.
  let assignedColor = color as string | undefined | null;
  if (!assignedColor) {
    const campCount = await scoped(prisma, speciesId).camp.count();
    assignedColor = CAMP_COLOR_PALETTE[campCount % CAMP_COLOR_PALETTE.length];
  }

  const camp = await prisma.camp.create({
    data: {
      campId,
      campName,
      species,
      sizeHectares: sizeHectares ? Number(sizeHectares) : null,
      waterSource: waterSource || null,
      geojson: geojson || null,
      color: assignedColor ?? null,
    },
  });

  // Return snake_case to match the GET /api/camps response shape.
  return {
    camp_id: camp.campId,
    camp_name: camp.campName,
    size_hectares: camp.sizeHectares,
    water_source: camp.waterSource,
    geojson: camp.geojson,
    color: camp.color,
    animal_count: 0,
  };
}
