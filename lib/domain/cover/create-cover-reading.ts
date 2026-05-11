/**
 * Issue #207 — domain op `createCoverReading`.
 *
 * First domain op in the `cover` directory (no `lib/domain/cover/` existed
 * pre-#207). Extracts the persistence step out of the inline route handler
 * in `app/api/[farmSlug]/camps/[campId]/cover/route.ts` so the idempotency
 * upsert lives in a single canonical place — mirrors
 * `lib/domain/observations/create-observation.ts` shipped under #206 / PR #214.
 *
 * Scope intentionally narrow: this op only persists the reading row. The
 * days-remaining math, camp/animal-count lookups, and fresh-admin gating
 * stay in the route handler (they're orthogonal to the idempotency
 * contract). A future wave can lift them into the domain layer if needed —
 * #207's diff stays bounded to the idempotency slice.
 */
import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

export interface CreateCoverReadingInput {
  campId: string;
  coverCategory: "Good" | "Fair" | "Poor";
  kgDmPerHa: number;
  useFactor: number;
  recordedBy: string;
  /**
   * ISO timestamp. Optional — when omitted the op uses `new Date().toISOString()`
   * so route adapters that don't need to pin the wall clock can stay terse.
   */
  recordedAt?: string;
  attachmentUrl?: string | null;
  /**
   * Issue #207 — client-generated UUID for idempotent retries. The cover
   * forms (`CampCoverForm`, `CoverReadingForm`) generate this at mount via
   * `crypto.randomUUID()`; the offline-sync queue replays it verbatim on
   * retry. When supplied, the domain op upserts on this column so a retried
   * submit returns the existing reading's id (200, not 409, not duplicate).
   * Omitting it falls back to the legacy create path — back-compat for
   * server-side / pre-#207 callers.
   */
  clientLocalId?: string | null;
}

export interface CreateCoverReadingResult {
  success: true;
  reading: Awaited<ReturnType<PrismaClient["campCoverReading"]["create"]>>;
}

export async function createCoverReading(
  prisma: PrismaClient,
  input: CreateCoverReadingInput,
): Promise<CreateCoverReadingResult> {
  const recordedAt = input.recordedAt ?? new Date().toISOString();

  const baseData = {
    id: randomUUID(),
    campId: input.campId,
    coverCategory: input.coverCategory,
    kgDmPerHa: input.kgDmPerHa,
    useFactor: input.useFactor,
    recordedAt,
    recordedBy: input.recordedBy,
    attachmentUrl: input.attachmentUrl ?? null,
  };

  // Issue #207 — idempotent write path. `update: {}` keeps first-write
  // content canonical; the SELECT-then-INSERT race lives in `create`. The
  // UNIQUE index (`idx_camp_cover_reading_client_local_id`, migration 0020)
  // collapses concurrent retries down to a single row at the DB layer.
  if (input.clientLocalId) {
    const reading = await prisma.campCoverReading.upsert({
      where: { clientLocalId: input.clientLocalId },
      update: {},
      create: {
        ...baseData,
        clientLocalId: input.clientLocalId,
      },
    });
    return { success: true, reading };
  }

  const reading = await prisma.campCoverReading.create({ data: baseData });
  return { success: true, reading };
}
