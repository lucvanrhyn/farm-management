/**
 * Issue #207 — domain op `createAnimal`.
 *
 * First Animal domain op (no `lib/domain/animals/` directory existed pre-#207).
 * The animal-creation logic previously lived inline in `app/api/animals/route.ts`;
 * this slice extracts it so the route becomes a thin adapter and the idempotency
 * upsert lives in a single canonical place — same shape as
 * `lib/domain/observations/create-observation.ts` shipped under #206 / PR #214.
 *
 * Behaviour:
 *   - Validates the small enumerations (sex, species, status) and field
 *     length/shape — same rules the route enforced inline, lifted verbatim.
 *   - When `clientLocalId` is supplied, persists via `prisma.animal.upsert`
 *     so a retried POST (offline replay, network blip, browser reload)
 *     collapses to a single row. The `update: {}` is intentional: first-write
 *     content is canonical — a retry MUST NOT mutate the persisted row.
 *   - When `clientLocalId` is omitted, falls back to `prisma.animal.create`
 *     (legacy callers, e.g. server-side seed scripts).
 *
 * Per-tenant Turso DB architecture means the multi-tenant PRD's
 * `@@unique([farmId, clientLocalId])` collapses to `@unique` on the column —
 * there is no shared `Animal` table across farms.
 */
import type { PrismaClient } from "@prisma/client";

export const VALID_ANIMAL_SPECIES = ["cattle", "sheep", "game"] as const;
export const VALID_ANIMAL_SEX = ["Male", "Female"] as const;
export const VALID_ANIMAL_STATUS = ["Active", "Sold", "Dead", "Removed"] as const;

export type AnimalSpecies = (typeof VALID_ANIMAL_SPECIES)[number];
export type AnimalSex = (typeof VALID_ANIMAL_SEX)[number];
export type AnimalStatus = (typeof VALID_ANIMAL_STATUS)[number];

export class CreateAnimalValidationError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = "CreateAnimalValidationError";
  }
}

export interface CreateAnimalInput {
  animalId: string;
  name?: string | null;
  sex: string;
  dateOfBirth?: string | null;
  breed?: string;
  category: string;
  currentCamp: string;
  status?: string;
  motherId?: string | null;
  fatherId?: string | null;
  species?: string;
  tagNumber?: string | null;
  brandSequence?: string | null;
  dateAdded?: string;
  /**
   * Issue #207 — client-generated UUID for idempotent retries. The admin
   * `RecordBirthButton` form generates this at mount via `crypto.randomUUID()`;
   * the offline-sync queue replays it verbatim on retry. When supplied, the
   * domain op upserts on this column so a retried create returns the existing
   * animal's id (200, not 409, not duplicate row). Omitting it falls back to
   * the legacy create path — back-compat for callers that pre-date #207
   * (server-side seed scripts, calving auto-create from observation flow).
   */
  clientLocalId?: string | null;
}

export interface CreateAnimalResult {
  success: true;
  // Forwarded as the route's `animal` field for back-compat with the wire
  // shape the original inline handler emitted.
  animal: Awaited<ReturnType<PrismaClient["animal"]["create"]>>;
}

/**
 * Validate + persist. Throws `CreateAnimalValidationError` for field-level
 * problems so the route adapter can map to a 400 envelope, mirroring the
 * existing inline route behaviour.
 */
export async function createAnimal(
  prisma: PrismaClient,
  input: CreateAnimalInput,
): Promise<CreateAnimalResult> {
  // Required fields — must come first because the route's 400 messages depend
  // on this exact ordering (existing `__tests__/api/animals.test.ts` baseline).
  if (!input.animalId || !input.sex || !input.category || !input.currentCamp) {
    throw new CreateAnimalValidationError(
      "required",
      "Missing required fields: animalId, sex, category, currentCamp",
    );
  }
  if (typeof input.animalId !== "string" || input.animalId.length > 50) {
    throw new CreateAnimalValidationError("animalId", "Invalid animalId");
  }
  if (!(VALID_ANIMAL_SEX as readonly string[]).includes(input.sex)) {
    throw new CreateAnimalValidationError("sex", "Invalid sex");
  }
  if (typeof input.category !== "string" || input.category.length > 50) {
    throw new CreateAnimalValidationError("category", "Invalid category");
  }
  if (
    input.species != null &&
    !(VALID_ANIMAL_SPECIES as readonly string[]).includes(input.species)
  ) {
    throw new CreateAnimalValidationError("species", "Invalid species");
  }
  if (
    input.status != null &&
    !(VALID_ANIMAL_STATUS as readonly string[]).includes(input.status)
  ) {
    throw new CreateAnimalValidationError("status", "Invalid status");
  }
  if (
    input.dateOfBirth != null &&
    (typeof input.dateOfBirth !== "string" ||
      Number.isNaN(Date.parse(input.dateOfBirth)))
  ) {
    throw new CreateAnimalValidationError(
      "dateOfBirth",
      "Invalid dateOfBirth",
    );
  }
  // AIA 2002 — tagNumber + brandSequence optional free-text, capped length.
  if (
    input.tagNumber != null &&
    (typeof input.tagNumber !== "string" || input.tagNumber.length > 50)
  ) {
    throw new CreateAnimalValidationError("tagNumber", "Invalid tagNumber");
  }
  if (
    input.brandSequence != null &&
    (typeof input.brandSequence !== "string" ||
      input.brandSequence.length > 50)
  ) {
    throw new CreateAnimalValidationError(
      "brandSequence",
      "Invalid brandSequence",
    );
  }

  const dateAdded =
    input.dateAdded ?? new Date().toISOString().split("T")[0]!;

  const baseData = {
    animalId: input.animalId,
    name: input.name ?? null,
    sex: input.sex,
    dateOfBirth: input.dateOfBirth ?? null,
    breed: input.breed && input.breed.length > 0 ? input.breed : undefined,
    category: input.category,
    currentCamp: input.currentCamp,
    status: input.status ?? "Active",
    motherId: input.motherId ?? null,
    fatherId: input.fatherId ?? null,
    species: input.species ?? "cattle",
    dateAdded,
    tagNumber:
      typeof input.tagNumber === "string" && input.tagNumber.trim()
        ? input.tagNumber.trim()
        : null,
    brandSequence:
      typeof input.brandSequence === "string" && input.brandSequence.trim()
        ? input.brandSequence.trim()
        : null,
  };

  // Issue #207 — idempotent write path. When the client supplies a UUID,
  // route through `upsert` so a retry returns the original row instead of
  // creating a duplicate. `update: {}` keeps the first-write content canonical
  // (audit trail integrity — a retry must NOT silently mutate the persisted
  // row). The SELECT-then-INSERT race lives in `create`; `upsert` against the
  // UNIQUE index (`idx_animal_client_local_id`, migration 0020) collapses
  // concurrent retries down to a single row at the DB layer.
  if (input.clientLocalId) {
    const animal = await prisma.animal.upsert({
      where: { clientLocalId: input.clientLocalId },
      update: {},
      create: {
        ...baseData,
        clientLocalId: input.clientLocalId,
      },
    });
    return { success: true, animal };
  }

  // Legacy fallback (no idempotency promise).
  const animal = await prisma.animal.create({ data: baseData });
  return { success: true, animal };
}
