/**
 * lib/sync/queue.ts — Sync queue facade (PRD #194, wave 1 of 3, issue #195).
 *
 * Why this module exists:
 *   The offline sync indicator has lied to users twice (Codex audit C1 + C3).
 *   Root cause was a caller-must-remember `tickLastSyncedAt` boolean threaded
 *   through `refreshCachedData`. Two callers forgot to pass `false` on
 *   all-failed cycles, so the UI showed "Synced: Just now" while every queued
 *   row had actually failed.
 *
 *   This facade owns sync state derivation. The UI eventually reads a single
 *   `SyncTruth` record from `getCurrentSyncTruth()`. The caller-must-remember
 *   class of bug is structurally impossible because cycle-level state can
 *   only move via `recordSyncAttempt({ timestamp, perKindResults })`, which
 *   derives `lastFullSuccessAt` from the per-kind result map.
 *
 * Scope of this wave (1/3):
 *   - Introduce the facade alongside the existing getters.
 *   - Migrate `lib/sync-manager.ts` writers to call the facade.
 *   - Leave UI consumers (`OfflineProvider`) untouched — they continue to
 *     read `getLastSyncedAt()` until wave 2 / issue #196.
 *
 * Storage:
 *   `pendingCount` / `failedCount` are derived live from the four pending
 *   stores in `lib/offline-store.ts` — there is no separate aggregate to
 *   keep in sync.
 *   `lastAttemptAt` / `lastFullSuccessAt` persist via the existing
 *   IndexedDB `metadata` object store, addressed by generic key/value
 *   helpers added in this wave (`getSyncMetadataValue` /
 *   `setSyncMetadataValue`).
 */

import {
  // Pending readers — live count for pendingCount.
  getPendingObservations,
  getPendingAnimalCreates,
  getPendingCoverReadings,
  getPendingPhotos,
  // Failure-status counters — live count for failedCount.
  getFailedObservationsCount,
  getFailedAnimalCreatesCount,
  getFailedCoverReadingsCount,
  getFailedPhotosCount,
  // Row-level writers — one per kind.
  markObservationFailed,
  markObservationSynced,
  markAnimalCreateFailed,
  markAnimalCreateSynced,
  markCoverReadingFailed,
  markCoverReadingSynced,
  markPhotoFailed,
  markPhotoSynced,
  // Cycle-level metadata persistence.
  getSyncMetadataValue,
  setSyncMetadataValue,
  // Enqueue helpers — re-exported under the facade.
  queueObservation,
  queueAnimalCreate,
  queueCoverReading,
  queuePhoto,
  type PendingObservation,
  type PendingAnimalCreate,
  type PendingCoverReading,
} from '@/lib/offline-store';

// ── Public types ─────────────────────────────────────────────────────────────

export type SyncKind = 'observation' | 'animal' | 'photo' | 'cover-reading';

export interface SyncFailure {
  reason: string;
  attempts: number;
  lastAttemptAt: number;
}

export interface SyncTruth {
  pendingCount: number;
  failedCount: number;
  /** ISO timestamp of the most recent sync attempt, regardless of outcome. */
  lastAttemptAt: string | null;
  /**
   * ISO timestamp of the most recent sync attempt where every kind had zero
   * failures. The UI uses this to render the "Synced: …" timestamp truthfully:
   * partial-failure cycles do not move this value.
   */
  lastFullSuccessAt: string | null;
}

export interface PerKindResult {
  synced: number;
  failed: number;
}

export interface SyncAttemptRecord {
  timestamp: string;
  perKindResults: Record<SyncKind, PerKindResult>;
}

// ── Storage keys ─────────────────────────────────────────────────────────────

const META_LAST_ATTEMPT = 'syncLastAttemptAt';
const META_LAST_FULL_SUCCESS = 'syncLastFullSuccessAt';

// ── enqueue ─────────────────────────────────────────────────────────────────
//
// Row payloads are still kind-specific because each underlying store has its
// own schema (PendingObservation vs PendingAnimalCreate vs PendingPhoto vs
// PendingCoverReading). The kind tag is a dispatch token only — payload
// validity is the caller's responsibility.

/**
 * Photo enqueue input. We accept `observationLocalId + blob` rather than the
 * full PendingPhoto shape because the underlying `queuePhoto` helper assembles
 * the `sync_status` field.
 */
export interface EnqueuePhotoInput {
  observationLocalId: number;
  blob: Blob;
}

export async function enqueuePending(
  kind: 'observation',
  row: Omit<PendingObservation, 'local_id'>,
): Promise<number>;
export async function enqueuePending(
  kind: 'animal',
  row: Omit<PendingAnimalCreate, 'local_id'>,
): Promise<number>;
export async function enqueuePending(
  kind: 'cover-reading',
  row: Omit<PendingCoverReading, 'local_id'>,
): Promise<number>;
export async function enqueuePending(kind: 'photo', row: EnqueuePhotoInput): Promise<number>;
export async function enqueuePending(kind: SyncKind, row: unknown): Promise<number> {
  switch (kind) {
    case 'observation':
      return queueObservation(row as Omit<PendingObservation, 'local_id'>);
    case 'animal':
      return queueAnimalCreate(row as Omit<PendingAnimalCreate, 'local_id'>);
    case 'cover-reading':
      return queueCoverReading(row as Omit<PendingCoverReading, 'local_id'>);
    case 'photo': {
      const { observationLocalId, blob } = row as EnqueuePhotoInput;
      return queuePhoto(observationLocalId, blob);
    }
  }
}

// ── row-level state transitions ──────────────────────────────────────────────

/**
 * Mark one queued row as successfully synced. Row-level success does NOT
 * tick cycle-level truth — only `recordSyncAttempt` may move `lastFullSuccessAt`.
 *
 * `serverPayload` is accepted for forward-compat (wave 2 may persist the
 * server-assigned id alongside the row). In this wave it is unused; the
 * existing per-kind writers in `lib/offline-store.ts` already drop the row
 * to `synced` status.
 */
export async function markSucceeded(
  kind: SyncKind,
  id: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _serverPayload?: unknown,
): Promise<void> {
  switch (kind) {
    case 'observation':
      await markObservationSynced(id);
      return;
    case 'animal':
      await markAnimalCreateSynced(id);
      return;
    case 'cover-reading':
      await markCoverReadingSynced(id);
      return;
    case 'photo':
      await markPhotoSynced(id);
      return;
  }
}

/**
 * Mark one queued row as failed. The `reason` is currently advisory — the
 * underlying row schemas don't carry a per-row failure reason yet (that
 * arrives in wave 2 when `SyncFailure` is wired through). Tracked here for
 * the public signature so callers can pass the HTTP status / parse error
 * text without a follow-up signature change.
 */
export async function markFailed(
  kind: SyncKind,
  id: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _reason: string,
): Promise<void> {
  switch (kind) {
    case 'observation':
      await markObservationFailed(id);
      return;
    case 'animal':
      await markAnimalCreateFailed(id);
      return;
    case 'cover-reading':
      await markCoverReadingFailed(id);
      return;
    case 'photo':
      await markPhotoFailed(id);
      return;
  }
}

// ── cycle-level state transition ─────────────────────────────────────────────

/**
 * Record a single sync attempt — invoked once per `syncAndRefresh` cycle by
 * the coordinator after every kind has been processed. This is the ONLY
 * place that may move `lastFullSuccessAt`, which is what makes the
 * caller-must-remember bug from C1/C3 structurally impossible.
 *
 * Always ticks `lastAttemptAt`. Ticks `lastFullSuccessAt` iff every entry in
 * `perKindResults` reports `failed === 0`.
 */
export async function recordSyncAttempt(record: SyncAttemptRecord): Promise<void> {
  // SyncTruth persistence is best-effort. If the metadata store is unavailable
  // (e.g. browser quota, transient IDB error, or — in some unit-test setups —
  // a partial mock of @/lib/offline-store), the coordinator must keep running:
  // the next attempt re-derives the truth, and the legacy `lastSyncedAt`
  // surface still ticks via the coordinator's separate code path. We log so a
  // genuine IDB failure isn't fully invisible.
  try {
    await setSyncMetadataValue(META_LAST_ATTEMPT, record.timestamp);

    const fullSuccess = Object.values(record.perKindResults).every((r) => r.failed === 0);
    if (fullSuccess) {
      await setSyncMetadataValue(META_LAST_FULL_SUCCESS, record.timestamp);
    }
  } catch (err) {
    console.warn('[sync/queue] recordSyncAttempt persistence failed:', err);
  }
}

// ── read ────────────────────────────────────────────────────────────────────

/**
 * Single source of truth for the UI. `epoch` is reserved for the wave-2
 * migration — when the OfflineProvider migrates, it will pass its captured
 * `farmEpoch` so stale-tenant reads return null. For wave 1 the parameter is
 * accepted but unused so the call signature is stable across waves.
 */
export async function getCurrentSyncTruth(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _epoch?: number,
): Promise<SyncTruth> {
  const [
    pendingObs,
    pendingAnimals,
    pendingCovers,
    pendingPhotos,
    failedObs,
    failedAnimals,
    failedCovers,
    failedPhotos,
    lastAttemptAt,
    lastFullSuccessAt,
  ] = await Promise.all([
    getPendingObservations(),
    getPendingAnimalCreates(),
    getPendingCoverReadings(),
    getPendingPhotos(),
    getFailedObservationsCount(),
    getFailedAnimalCreatesCount(),
    getFailedCoverReadingsCount(),
    getFailedPhotosCount(),
    getSyncMetadataValue(META_LAST_ATTEMPT),
    getSyncMetadataValue(META_LAST_FULL_SUCCESS),
  ]);

  // `getPendingXxx` returns rows in `pending` OR `failed` status (so the
  // sync loop retries failed rows on the next cycle). For `pendingCount` we
  // want only `pending` — failed rows are reported separately via
  // `failedCount`. Filter to the strict pending subset.
  const pendingCount =
    pendingObs.filter((o) => o.sync_status === 'pending').length +
    pendingAnimals.filter((a) => a.sync_status === 'pending').length +
    pendingCovers.filter((c) => c.sync_status === 'pending').length +
    pendingPhotos.filter((p) => p.sync_status === 'pending').length;

  const failedCount = failedObs + failedAnimals + failedCovers + failedPhotos;

  return {
    pendingCount,
    failedCount,
    lastAttemptAt,
    lastFullSuccessAt,
  };
}
