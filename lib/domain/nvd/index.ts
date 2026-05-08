/**
 * Wave G1 (#165) — public surface of the NVD domain ops.
 *
 * Each op is a pure function on `(prisma, ...)` that returns plain
 * JSON-serialisable data and throws typed errors for business-rule
 * violations. The transport adapters (`tenantReadSlug`, `adminWriteSlug`,
 * `tenantWriteSlug`) wire these into HTTP route handlers; the typed
 * errors map onto the wire envelope via `mapApiDomainError`.
 *
 * See `docs/adr/0001-route-handler-architecture.md` and
 * `tasks/wave-165-nvd.md`.
 */
export { issueNvd } from "./issue";
export { validateNvdAnimals } from "./validate";
export { voidNvd, voidNvdById } from "./void";
export { getNvdById, getNvdByIdOrThrow, listNvds } from "./get";
export type { ListNvdsArgs, ListNvdsResult } from "./get";
export { renderNvdPdf } from "./pdf";
export type { RenderedNvdPdf } from "./pdf";
export {
  buildSellerSnapshot,
  buildAnimalSnapshot,
  generateNvdNumber,
} from "./snapshot";
export type {
  SellerSnapshot,
  AnimalSnapshotEntry,
  ValidationResult,
  NvdTransportDetails,
  NvdIssueInput,
} from "./snapshot";
export {
  NvdNotFoundError,
  NvdAlreadyVoidedError,
  InvalidTransportError,
  MissingRequiredFieldError,
  InvalidAnimalIdsError,
  NVD_NOT_FOUND,
  NVD_ALREADY_VOIDED,
  INVALID_TRANSPORT,
  MISSING_REQUIRED_FIELD,
  INVALID_ANIMAL_IDS,
  type InvalidTransportField,
  type MissingRequiredField,
} from "./errors";
