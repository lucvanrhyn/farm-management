/**
 * Wave 309a (ADR-0001 Wave B, #309) — public surface of the camps domain ops.
 *
 * Each op is a pure function on `(prisma, input)` that returns plain
 * JSON-serialisable data and throws typed errors for business-rule
 * violations. The `adminWrite` adapter wires these into the
 * `app/api/camps/[campId]` route handler; the typed errors map onto the
 * wire envelope via `mapApiDomainError`.
 *
 * Not-found reuses the canonical `CampNotFoundError`
 * (`@/lib/domain/observations/errors`, wire `CAMP_NOT_FOUND` 404) — it is
 * a generic, reusable error and nothing depended on the pre-extraction
 * free-text body for this route.
 *
 * Wave 316a (#309) adds `createCamp` (POST /api/camps) — same contract:
 * the route keeps its `createCampSchema` parse + `SPECIES_OMITTED`
 * sentinel adapter, the op owns the business rules and throws
 * `MissingSpeciesError` (422) / `DuplicateCampError` (409).
 *
 * See `docs/adr/0001-route-handler-architecture.md`,
 * `tasks/wave-309a-camps-domain.md`,
 * `tasks/wave-316a-camps-create-domain.md`, and
 * `tasks/issue-309-adr-0001-waveB-triage.md`.
 */
export {
  createCamp,
  SPECIES_OMITTED,
  type CreateCampInput,
  type CreateCampResult,
} from "./create-camp";
export {
  updateCamp,
  type PatchCampBody,
  type UpdateCampInput,
  type UpdateCampResult,
} from "./update-camp";
export { deleteCamp, type DeleteCampResult } from "./delete-camp";
export {
  CampHasActiveAnimalsError,
  CAMP_HAS_ACTIVE_ANIMALS,
  MissingSpeciesError,
  MISSING_SPECIES,
  DuplicateCampError,
  DUPLICATE_CAMP,
} from "./errors";
