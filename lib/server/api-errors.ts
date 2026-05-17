import { NextResponse } from "next/server";
import { routeError } from "@/lib/server/route/envelope";
import {
  CrossSpeciesBlockedError,
  MobNotFoundError,
} from "@/lib/domain/mobs/move-mob";
import {
  MobHasAnimalsError,
  NotFoundError,
  WrongSpeciesError,
} from "@/lib/domain/mobs/errors";
import {
  CampNotFoundError,
  InvalidTimestampError,
  InvalidTypeError,
  ObservationNotFoundError,
} from "@/lib/domain/observations/errors";
import { CampHasActiveAnimalsError } from "@/lib/domain/camps/errors";
import {
  AnimalFieldForbiddenError,
  AnimalNotFoundError,
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
export function mapApiDomainError(err: unknown): NextResponse | null {
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
  // Wave 309a (ADR-0001 Wave B, #309) — camps domain delete guard.
  if (err instanceof CampHasActiveAnimalsError) {
    // Wire shape preserves the count-bearing message (legacy clients
    // display the `error` field as a sentence — not migrated to a typed
    // code). Byte-identical to the pre-extraction route literal.
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
