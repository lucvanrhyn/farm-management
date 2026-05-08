import { NextResponse } from "next/server";
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
  return null;
}
