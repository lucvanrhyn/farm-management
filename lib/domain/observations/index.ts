/**
 * Wave C (#156) — public surface of the observations domain ops.
 *
 * Each op is a pure function on `(prisma, input)` that returns plain
 * JSON-serialisable data and throws typed errors for business-rule
 * violations. The transport adapters (`tenantRead`, `tenantWrite`,
 * `adminWrite`) wire these into HTTP route handlers; the typed errors
 * map onto the wire envelope via `mapApiDomainError`.
 *
 * See `docs/adr/0001-route-handler-architecture.md` and
 * `tasks/wave-156-observations-domain.md`.
 */
export {
  listObservations,
  type ListObservationsFilters,
} from "./list-observations";
export {
  createObservation,
  VALID_OBSERVATION_TYPES,
  type CreateObservationInput,
  type CreateObservationResult,
} from "./create-observation";
export {
  updateObservation,
  type UpdateObservationInput,
} from "./update-observation";
export {
  deleteObservation,
  type DeleteObservationResult,
} from "./delete-observation";
export {
  resetObservations,
  type ResetObservationsResult,
} from "./reset-observations";
export {
  attachObservationPhoto,
  type AttachObservationPhotoInput,
  type AttachObservationPhotoResult,
} from "./attach-photo";
export {
  ObservationNotFoundError,
  CampNotFoundError,
  InvalidTypeError,
  InvalidTimestampError,
  OBSERVATION_NOT_FOUND,
  CAMP_NOT_FOUND,
  INVALID_TYPE,
  INVALID_TIMESTAMP,
} from "./errors";
