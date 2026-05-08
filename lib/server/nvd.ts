/**
 * lib/server/nvd.ts
 *
 * Wave G1 (#165) — RE-EXPORT SHIM for `lib/domain/nvd/*`.
 *
 * The full NVD business logic moved into `lib/domain/nvd/*` so the
 * route handlers compress to a single adapter call. This file is kept
 * as a thin re-export so legacy callers (PDF builder, exporters, tests
 * under `__tests__/lib/server/nvd.test.ts`, the existing
 * `__tests__/api/nvd-transport-route.test.ts`) keep working without
 * modification. New code should import directly from
 * `@/lib/domain/nvd`.
 *
 * No behaviour change vs. the pre-G1 module surface. Wire shape is
 * preserved at the route boundary by `lib/server/api-errors.ts`'s
 * mapping of the new typed errors.
 */
export {
  issueNvd,
  validateNvdAnimals,
  voidNvd,
  buildSellerSnapshot,
  buildAnimalSnapshot,
  generateNvdNumber,
} from "@/lib/domain/nvd";
export type {
  SellerSnapshot,
  AnimalSnapshotEntry,
  ValidationResult,
  NvdTransportDetails,
  NvdIssueInput,
} from "@/lib/domain/nvd";
