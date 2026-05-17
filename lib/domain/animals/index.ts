/**
 * Wave 309b (ADR-0001 Wave B, #309) — public surface of the animals
 * domain ops.
 *
 * Each op is a pure function on `(prisma, input)` that returns plain
 * JSON-serialisable data and throws typed errors for business-rule
 * violations. The transport adapters (`tenantRead`, `tenantWrite`) wire
 * these into the `app/api/animals/[id]` route handler; the typed errors
 * map onto the wire envelope via `mapApiDomainError`.
 *
 * Behaviour-preserving: this route carries authorization + validation,
 * so the animals error arms reproduce the *legacy* wire literals
 * byte-identical (NOT the canonical SCREAMING_SNAKE direction). See
 * `lib/domain/animals/errors.ts`.
 *
 * `createAnimal` (issue #207) predates this directory; it is re-exported
 * here so the full animals surface lives behind one barrel, mirroring
 * `lib/domain/mobs/index.ts`. Existing direct
 * `@/lib/domain/animals/create-animal` imports remain valid and are out
 * of scope for 309b.
 *
 * The cross-species *parent* mismatch reuses `CrossSpeciesBlockedError`,
 * centralised in `@/lib/species/errors` (#315) and already mapped to 422.
 *
 * See `docs/adr/0001-route-handler-architecture.md` and
 * `tasks/wave-309b-animals-domain.md`.
 */
export {
  createAnimal,
  CreateAnimalValidationError,
  VALID_ANIMAL_SPECIES,
  VALID_ANIMAL_SEX,
  VALID_ANIMAL_STATUS,
  type CreateAnimalInput,
  type CreateAnimalResult,
  type AnimalSpecies,
  type AnimalSex,
  type AnimalStatus,
} from "./create-animal";
export { getAnimal, type AnimalRow } from "./get-animal";
export {
  updateAnimal,
  type UpdateAnimalInput,
  type UpdatedAnimal,
} from "./update-animal";
export {
  AnimalNotFoundError,
  AnimalFieldForbiddenError,
  InvalidAnimalFieldError,
  ParentNotFoundError,
  SpeciesScopedCampError,
  PARENT_NOT_FOUND,
} from "./errors";
