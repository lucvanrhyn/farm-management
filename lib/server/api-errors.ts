import { NextResponse } from "next/server";
import { routeError } from "@/lib/server/route/envelope";
import { logger } from "@/lib/logger";
import { CrossSpeciesBlockedError } from "@/lib/species/errors";
import { MobNotFoundError } from "@/lib/domain/mobs/move-mob";
import {
  MobHasAnimalsError,
  NotFoundError,
  WrongSpeciesError,
} from "@/lib/domain/mobs/errors";
import {
  AnimalNotFoundError as ObservationAnimalNotFoundError,
  CampNotFoundError,
  DuplicateObservationError,
  InvalidTimestampError,
  InvalidTypeError,
  NoteTooLongError,
  ObservationNotFoundError,
} from "@/lib/domain/observations/errors";
import { CampConditionFieldRequiredError } from "@/lib/domain/observations/create-observation";
// ADR-0007 (#513) — per-type `details` validation moved into the write door
// (`lib/domain/observations/details-schemas.ts`). The weighing error keeps its
// identity; the death + repro errors are now thrown from the door (previously
// mapped inline in `app/api/observations/route.ts`) and so must be mapped here.
import {
  WeightOutOfRangeError,
  DeathMultiCauseError,
  DeathDisposalRequiredError,
  ReproMultiStateError,
  ReproRequiredError,
  ReproFieldRequiredError,
} from "@/lib/domain/observations/details-schemas";
import {
  CampHasActiveAnimalsError,
  DuplicateCampError,
  MissingSpeciesError,
} from "@/lib/domain/camps/errors";
import {
  AnimalFieldForbiddenError,
  AnimalNotFoundError,
  AnimalRoleForbiddenError,
  InvalidAnimalFieldError,
  ParentNotFoundError,
  SpeciesScopedCampError,
} from "@/lib/domain/animals/errors";
import {
  InvalidDateFormatError,
  InvalidSaleTypeError,
  TransactionNotFoundError,
} from "@/lib/domain/transactions/errors";
import {
  InvalidCursorError,
  InvalidLimitError,
  InvalidRecurrenceRuleError,
  TaskNotFoundError,
  TemplateNotFoundError,
} from "@/lib/domain/tasks/errors";
import {
  BlobNotConfiguredError,
  BlobUploadFailedError,
  FileTooLargeError,
  InvalidFileTypeError,
  MissingFileError,
} from "@/lib/domain/photos/errors";
import {
  InvalidSubscriptionError,
  MissingEndpointError,
} from "@/lib/domain/push/errors";
import {
  InvalidAnimalIdsError,
  InvalidTransportError,
  MissingRequiredFieldError,
  NvdAlreadyVoidedError,
  NvdNotFoundError,
} from "@/lib/domain/nvd/errors";
import {
  BlankNameError,
  InvalidDateError as RotationInvalidDateError,
  InvalidOrderError,
  InvalidPlannedDaysError,
  InvalidStatusError,
  MissingFieldError as RotationMissingFieldError,
  MissingMobIdError,
  MobAlreadyInCampError,
  PlanNotFoundError,
  StepAlreadyExecutedError,
  StepNotFoundError,
} from "@/lib/domain/rotation/errors";

/**
 * Maps a thrown domain error onto the canonical HTTP response for that
 * error class. Returns `null` if the error is unknown — callers should
 * rethrow so Next.js' default 500 handler kicks in.
 *
 * Example:
 *   try { await performMobMove(...); }
 *   catch (err) {
 *     const mapped = mapApiDomainError(err);
 *     if (mapped) return mapped;
 *     throw err;
 *   }
 *
 * Status/body contract is the live one used by `app/api/mobs/[mobId]`
 * (404 "Mob not found") and `app/api/animals/[id]` (422
 * "CROSS_SPECIES_BLOCKED"); changing it is an API break.
 *
 * Wave B (#151) extension — added `WrongSpeciesError` (422 WRONG_SPECIES),
 * `NotFoundError` (422 NOT_FOUND), `MobHasAnimalsError` (409 with the
 * count-bearing message). All three are emitted by the new `lib/domain/mobs/*`
 * ops. Wire shape stays bare `{ error: CODE }` so the pre-Wave-B tests
 * (which compared by strict equality) keep passing without modification.
 *
 * Wave 309b (ADR-0001 Wave B, #309) extension — added the animals
 * `[id]` GET/PATCH arms (`AnimalNotFoundError` → 404 `{error:"Not
 * found"}`, `AnimalFieldForbiddenError` → the `routeError("FORBIDDEN",
 * "Forbidden",403)` envelope, `InvalidAnimalFieldError` → 400 free-text,
 * `ParentNotFoundError` → 422 `PARENT_NOT_FOUND`, `SpeciesScopedCampError`
 * → 422 NOT_FOUND|WRONG_SPECIES). This route carries authorization +
 * validation so every arm reproduces the PRE-extraction literal
 * byte-identical — NOT the canonical SCREAMING_SNAKE direction.
 */
/**
 * Issue #483 (Epic B1, security) — Prisma exception class names. We match
 * by `err.name` (not `instanceof`) so this module never takes a runtime
 * dependency on `@prisma/client` — same lightweight-detection convention as
 * `lib/server/alerts/dedup.ts`'s P2002 guard. Any of these classes carries
 * raw internal-schema text (table/column/payload) in its `message`, which
 * must NEVER reach an authenticated client. We collapse them all to the
 * canonical opaque `DB_QUERY_FAILED` envelope and log the full error
 * server-side.
 */
const PRISMA_ERROR_NAMES: ReadonlySet<string> = new Set([
  "PrismaClientValidationError",
  "PrismaClientKnownRequestError",
  "PrismaClientInitializationError",
  "PrismaClientRustPanicError",
  "PrismaClientUnknownRequestError",
]);

function isPrismaError(err: unknown): err is Error {
  return err instanceof Error && PRISMA_ERROR_NAMES.has(err.name);
}

export function mapApiDomainError(err: unknown): NextResponse | null {
  // Issue #483 — sanitize Prisma throws BEFORE the per-adapter fallthrough.
  // Returns the opaque DB_QUERY_FAILED envelope (no `message`) so no raw
  // schema text leaks; the full error is preserved in the server log.
  if (isPrismaError(err)) {
    logger.error("[api-errors] Prisma error sanitized to DB_QUERY_FAILED", {
      error: err,
    });
    return routeError("DB_QUERY_FAILED", undefined, 500);
  }
  if (err instanceof MobNotFoundError) {
    return NextResponse.json({ error: "Mob not found" }, { status: 404 });
  }
  if (err instanceof CrossSpeciesBlockedError) {
    return NextResponse.json({ error: err.code }, { status: 422 });
  }
  if (err instanceof WrongSpeciesError) {
    return NextResponse.json({ error: err.code }, { status: 422 });
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.code }, { status: 422 });
  }
  if (err instanceof MobHasAnimalsError) {
    // Wire shape preserves the count-bearing message (legacy clients display
    // the `error` field as a sentence — not yet migrated to a typed code).
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  // Wave C (#156) — observations domain typed errors.
  if (err instanceof ObservationNotFoundError) {
    return NextResponse.json({ error: err.code }, { status: 404 });
  }
  if (err instanceof CampNotFoundError) {
    return NextResponse.json({ error: err.code }, { status: 404 });
  }
  // S5 / OBS-2 — the observation-write path's missing-animal error. Thrown by
  // the door's species-stamping waterfall (ADR-0006 FK miss) AND by
  // `performAnimalDeath`/`performAnimalMove` when their tag-keyed
  // `tx.animal.update` hits Prisma P2025. The offline replay made
  // missing-animal a REACHABLE wire case (an animal deleted server-side while
  // a death/move sat in the queue), so it gets a typed terminal 404 the sync
  // classifier (`classifySyncFailure`) dead-letters — instead of the pre-S5
  // unmapped fall-through to an opaque 500 the queue retried forever. Distinct
  // from the animals-domain `AnimalNotFoundError` arm below, which pins the
  // legacy `{ error: "Not found" }` free-text for the animals `[id]` routes.
  if (err instanceof ObservationAnimalNotFoundError) {
    return NextResponse.json({ error: err.code }, { status: 404 });
  }
  // Wave 309a (ADR-0001 Wave B, #309) — camps domain delete guard.
  if (err instanceof CampHasActiveAnimalsError) {
    // Wire shape preserves the count-bearing message (legacy clients
    // display the `error` field as a sentence — not migrated to a typed
    // code). Byte-identical to the pre-extraction route literal.
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  // Wave 316a (ADR-0001 Wave B, #309) — camps domain create guards.
  if (err instanceof MissingSpeciesError) {
    // Issue #232 — typed 422 (distinct from schema VALIDATION_FAILED 400).
    return NextResponse.json({ error: "MISSING_SPECIES" }, { status: 422 });
  }
  if (err instanceof DuplicateCampError) {
    // Wire shape preserves the free-text message (the legacy admin form
    // pattern-matches it). Byte-identical to the pre-extraction route
    // literal `{ error: "A camp with this ID already exists" }`.
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  // Wave 309b (ADR-0001 Wave B, #309) — animals `[id]` GET/PATCH ops.
  // This route carries authorization + validation; the wave is strictly
  // behaviour-preserving so each arm reproduces the PRE-extraction wire
  // literal byte-identical (NOT the canonical SCREAMING_SNAKE direction).
  if (err instanceof AnimalNotFoundError) {
    // Legacy GET 404 body was the free-text `{ error: "Not found" }`.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (err instanceof AnimalFieldForbiddenError) {
    // Legacy route minted this via `routeError("FORBIDDEN", "Forbidden",
    // 403)` → body `{ error: "FORBIDDEN", message: "Forbidden" }`. Reuse
    // the exact same minter so the envelope stays byte-identical.
    return routeError("FORBIDDEN", "Forbidden", 403);
  }
  // Wave 316b (ADR-0001 Wave B, #309) — the POST `/api/animals` collection
  // role gate, relocated from the route into `createAnimal`. The legacy
  // route minted a non-ADMIN/non-LOGGER rejection via the IDENTICAL
  // `routeError("FORBIDDEN", "Forbidden", 403)` call → body
  // `{ error: "FORBIDDEN", message: "Forbidden" }` at status 403. Re-mint
  // through the exact same minter so the envelope stays byte-identical.
  if (err instanceof AnimalRoleForbiddenError) {
    return routeError("FORBIDDEN", "Forbidden", 403);
  }
  if (err instanceof InvalidAnimalFieldError) {
    // Legacy 400 body was the free-text enum sentence (`status must be
    // one of: ...` / `sex must be one of: ...`) under the `error` key.
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof ParentNotFoundError) {
    // Legacy 422 body literal `{ error: "PARENT_NOT_FOUND" }`.
    return NextResponse.json({ error: err.code }, { status: 422 });
  }
  if (err instanceof SpeciesScopedCampError) {
    // Legacy 422 body `{ error: result.reason }` (NOT_FOUND|WRONG_SPECIES).
    return NextResponse.json({ error: err.reason }, { status: 422 });
  }
  if (err instanceof InvalidTypeError) {
    return NextResponse.json({ error: err.code }, { status: 422 });
  }
  if (err instanceof InvalidTimestampError) {
    return NextResponse.json({ error: err.code }, { status: 400 });
  }
  // Issue #492 — over-length free-text note. 400 (NOT 422): it is a
  // malformed-input / shape error like INVALID_TIMESTAMP, not a domain
  // business-rule conflict. Forwards the typed `code` + the `maxLength` so
  // the UI can surface a precise limit — never the raw note (no user text
  // leaks into logs; audit-error-envelope clean).
  if (err instanceof NoteTooLongError) {
    return NextResponse.json(
      { error: err.code, details: { maxLength: err.maxLength } },
      { status: 400 },
    );
  }
  if (err instanceof CampConditionFieldRequiredError) {
    return NextResponse.json(
      { error: err.code, details: { field: err.field } },
      { status: 422 },
    );
  }
  // Issue #366 — byte-identical duplicate camp_condition. 422: per the
  // offline-sync terminal-status contract (`isTerminalStatus`), a payload
  // the server "understood and definitively rejected" is a poison message
  // — a duplicate's identical payload re-rejects identically forever, so a
  // blind retry is futile and the row must be discardable, not looped. The
  // body carries `existingId` + the typed code so `FailedSyncDialog`
  // surfaces a clear "already logged" message rather than a generic
  // poison-row notice.
  if (err instanceof DuplicateObservationError) {
    return NextResponse.json(
      { error: err.code, details: { existingId: err.existingId } },
      { status: 422 },
    );
  }
  // Issue #487 (PRD #479, Epic C) — species-aware weight gate. Thrown by the
  // `createObservation` (before the idempotency upsert) and `updateObservation`
  // doors for a `weighing` observation whose `weight_kg` is missing, ≤ 0,
  // non-numeric, or above the species ceiling. 422 (not 400) matches the
  // sibling observation business-rule rejections (DEATH_*, REPRO_*) and the
  // offline-sync terminal-status contract: an identical bad-weight payload
  // re-rejects identically forever, so the row is a poison message the queue
  // must discard rather than loop. Forwards the typed `err.code` — never the
  // raw message — so no internal text leaks (audit-error-envelope clean).
  if (err instanceof WeightOutOfRangeError) {
    return NextResponse.json({ error: err.code }, { status: 422 });
  }
  // ADR-0007 (#513) — death + reproductive-state details validation. These
  // moved OUT of `app/api/observations/route.ts` (where they were mapped inline
  // via `routeError(err.code, err.message, 422)`) INTO the write door
  // (`validateObservationDetails`), so the door now throws them and they are
  // mapped here. The envelope is reproduced BYTE-IDENTICALLY — same code, same
  // human `message`, same 422 — via the very same `routeError` minter the route
  // used, so the offline-sync `isTerminalStatus` classifier, `FailedSyncDialog`,
  // and the existing validator test suites see no wire change.
  if (
    err instanceof DeathMultiCauseError ||
    err instanceof DeathDisposalRequiredError ||
    err instanceof ReproMultiStateError ||
    err instanceof ReproRequiredError ||
    err instanceof ReproFieldRequiredError
  ) {
    return routeError(err.code, err.message, 422);
  }
  // Wave D (#159) — transactions domain typed errors.
  if (err instanceof TransactionNotFoundError) {
    return NextResponse.json({ error: err.code }, { status: 404 });
  }
  if (err instanceof InvalidSaleTypeError) {
    return NextResponse.json({ error: err.code }, { status: 422 });
  }
  if (err instanceof InvalidDateFormatError) {
    return NextResponse.json(
      { error: err.code, details: { field: err.field } },
      { status: 400 },
    );
  }
  // Wave E (#161) — tasks domain typed errors.
  if (err instanceof TaskNotFoundError) {
    return NextResponse.json({ error: err.code }, { status: 404 });
  }
  if (err instanceof InvalidRecurrenceRuleError) {
    return NextResponse.json({ error: err.code }, { status: 400 });
  }
  if (err instanceof TemplateNotFoundError) {
    // 400 (NOT 404) — matches pre-Wave-E wire shape; offline clients code
    // against 400. See lib/domain/tasks/errors.ts module docstring.
    return NextResponse.json({ error: err.code }, { status: 400 });
  }
  if (err instanceof InvalidLimitError) {
    return NextResponse.json({ error: err.code }, { status: 400 });
  }
  if (err instanceof InvalidCursorError) {
    return NextResponse.json({ error: err.code }, { status: 400 });
  }
  // Wave F (#163) — photos domain typed errors.
  if (err instanceof BlobNotConfiguredError) {
    return NextResponse.json({ error: err.code }, { status: 503 });
  }
  if (err instanceof MissingFileError) {
    return NextResponse.json({ error: err.code }, { status: 400 });
  }
  if (err instanceof FileTooLargeError) {
    return NextResponse.json({ error: err.code }, { status: 413 });
  }
  if (err instanceof InvalidFileTypeError) {
    return NextResponse.json({ error: err.code }, { status: 415 });
  }
  if (err instanceof BlobUploadFailedError) {
    return NextResponse.json({ error: err.code }, { status: 500 });
  }
  // Wave F (#163) — push domain typed errors.
  if (err instanceof InvalidSubscriptionError) {
    return NextResponse.json({ error: err.code }, { status: 400 });
  }
  if (err instanceof MissingEndpointError) {
    return NextResponse.json({ error: err.code }, { status: 400 });
  }
  // Wave G1 (#165) — NVD domain typed errors.
  if (err instanceof NvdNotFoundError) {
    return NextResponse.json({ error: err.code }, { status: 404 });
  }
  if (err instanceof NvdAlreadyVoidedError) {
    return NextResponse.json({ error: err.code }, { status: 409 });
  }
  if (err instanceof InvalidTransportError) {
    return NextResponse.json(
      { error: err.code, details: { field: err.field } },
      { status: 400 },
    );
  }
  if (err instanceof MissingRequiredFieldError) {
    return NextResponse.json(
      { error: err.code, details: { field: err.field } },
      { status: 400 },
    );
  }
  if (err instanceof InvalidAnimalIdsError) {
    return NextResponse.json({ error: err.code }, { status: 400 });
  }
  // Wave G2 (#166) — rotation domain typed errors.
  if (err instanceof PlanNotFoundError) {
    return NextResponse.json({ error: err.code }, { status: 404 });
  }
  if (err instanceof StepNotFoundError) {
    return NextResponse.json({ error: err.code }, { status: 404 });
  }
  if (err instanceof StepAlreadyExecutedError) {
    return NextResponse.json(
      { error: err.code, details: { currentStatus: err.currentStatus } },
      { status: 409 },
    );
  }
  if (err instanceof InvalidStatusError) {
    return NextResponse.json(
      { error: err.code, details: { field: err.field, allowed: err.allowed } },
      { status: 400 },
    );
  }
  if (err instanceof BlankNameError) {
    return NextResponse.json({ error: err.code }, { status: 400 });
  }
  if (err instanceof RotationInvalidDateError) {
    return NextResponse.json(
      { error: err.code, details: { field: err.field } },
      { status: 400 },
    );
  }
  if (err instanceof RotationMissingFieldError) {
    return NextResponse.json(
      { error: err.code, details: { field: err.field } },
      { status: 400 },
    );
  }
  if (err instanceof InvalidPlannedDaysError) {
    return NextResponse.json({ error: err.code }, { status: 400 });
  }
  if (err instanceof InvalidOrderError) {
    return NextResponse.json(
      { error: err.code, details: { expected: err.expected, actual: err.actual } },
      { status: 400 },
    );
  }
  if (err instanceof MissingMobIdError) {
    return NextResponse.json({ error: err.code }, { status: 400 });
  }
  if (err instanceof MobAlreadyInCampError) {
    return NextResponse.json({ error: err.code }, { status: 409 });
  }
  return null;
}
