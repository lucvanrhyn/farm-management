/**
 * DTO boundary: Prisma (camelCase) ↔ client (snake_case).
 *
 * WHY:
 *   Before this module existed, every API route hand-mapped Prisma rows to
 *   the snake_case shape that `lib/types.ts` exposes to client components.
 *   That scattered the shape contract across ~40 route files; a missed
 *   field meant the client silently rendered `undefined`.
 *
 *   Centralising the mappers here gives us:
 *     - One place to update when the schema grows a column
 *     - Compile-time proof that every field crosses the wire
 *     - A unit-testable pure-function boundary for fixtures
 *
 * USAGE:
 *   ```ts
 *   import { toCampDTO } from "@/lib/api/dto";
 *   const rows = await prisma.camp.findMany();
 *   return Response.json(rows.map((c) => toCampDTO(c, animalCountMap.get(c.campId))));
 *   ```
 *
 * NON-BREAKING: existing hand-mapped routes still work. Migrate them at the
 * natural rate — when a route is touched for another reason, replace its
 * inline mapping with these helpers.
 */

import type {
  Camp as PrismaCamp,
  Animal as PrismaAnimalRow,
  Observation as PrismaObservationRow,
} from "@prisma/client";
import type {
  Camp,
  PrismaAnimal,
  PrismaObservation,
  AnimalSex,
  AnimalStatus,
  AnimalCategory,
  ObservationType,
  GrazingQuality,
  WaterStatus,
  FenceStatus,
} from "@/lib/types";

// ── Camp ────────────────────────────────────────────────────────────────────

export interface CampLiveCondition {
  grazing_quality?: GrazingQuality;
  water_status?: WaterStatus;
  fence_status?: FenceStatus;
  last_inspected_at?: string;
  last_inspected_by?: string;
}

/**
 * Map a Prisma Camp row to the snake_case `Camp` DTO client components expect.
 * `animalCount` and `liveCondition` are optional enrichments that API routes
 * typically compute from parallel queries.
 */
export function toCampDTO(
  row: PrismaCamp,
  animalCount?: number,
  liveCondition?: CampLiveCondition,
): Camp {
  return {
    camp_id: row.campId,
    camp_name: row.campName,
    size_hectares: row.sizeHectares ?? undefined,
    water_source: row.waterSource ?? undefined,
    geojson: row.geojson ?? undefined,
    color: row.color ?? undefined,
    animal_count: animalCount,
    grazing_quality: liveCondition?.grazing_quality,
    water_status: liveCondition?.water_status,
    fence_status: liveCondition?.fence_status,
    last_inspected_at: liveCondition?.last_inspected_at,
    last_inspected_by: liveCondition?.last_inspected_by,
  };
}

// ── Animal ──────────────────────────────────────────────────────────────────

/**
 * Map a Prisma Animal row to the `PrismaAnimal` wire shape (camelCase, ISO
 * strings). `/api/animals` returns camelCase because the admin UI reads
 * camelCase; the logger's `Animal` snake_case DTO is a separate boundary.
 */
export function toPrismaAnimalDTO(row: PrismaAnimalRow): PrismaAnimal {
  // In the current schema dateOfBirth / dateAdded / deceasedAt are stored as
  // String (ISO), while createdAt is DateTime. Keep the wire contract as
  // strings across the board so the client doesn't have to branch.
  return {
    id: row.id,
    animalId: row.animalId,
    name: row.name,
    sex: row.sex,
    dateOfBirth: row.dateOfBirth,
    breed: row.breed,
    category: row.category as AnimalCategory,
    currentCamp: row.currentCamp,
    status: row.status as AnimalStatus,
    species: row.species,
    motherId: row.motherId,
    fatherId: row.fatherId,
    mobId: row.mobId,
    registrationNumber: row.registrationNumber,
    dateAdded: row.dateAdded,
    deceasedAt: row.deceasedAt,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Narrowed form for lists that only need identification + placement — skips
 * the bulky audit fields. Useful for `/api/camps` animal-count joins.
 */
export interface AnimalSummaryDTO {
  animalId: string;
  name: string | null;
  sex: AnimalSex;
  category: AnimalCategory;
  currentCamp: string;
  status: AnimalStatus;
}

export function toAnimalSummaryDTO(
  row: Pick<
    PrismaAnimalRow,
    "animalId" | "name" | "sex" | "category" | "currentCamp" | "status"
  >,
): AnimalSummaryDTO {
  return {
    animalId: row.animalId,
    name: row.name,
    sex: row.sex as AnimalSex,
    category: row.category as AnimalCategory,
    currentCamp: row.currentCamp,
    status: row.status as AnimalStatus,
  };
}

// ── Observation ─────────────────────────────────────────────────────────────

/**
 * Map a Prisma Observation row to the `PrismaObservation` wire shape.
 * Mirrors the hand-mapped projection used by `/api/observations`.
 */
export function toPrismaObservationDTO(
  row: PrismaObservationRow,
): PrismaObservation {
  return {
    id: row.id,
    type: row.type as ObservationType,
    campId: row.campId,
    animalId: row.animalId,
    details: row.details,
    observedAt: row.observedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    loggedBy: row.loggedBy,
    editedBy: row.editedBy,
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    editHistory: row.editHistory,
    attachmentUrl: row.attachmentUrl,
  };
}
