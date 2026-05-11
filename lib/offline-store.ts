import { openDB, IDBPDatabase } from 'idb';
import { Camp, Animal, AnimalStatus, GrazingQuality, WaterStatus, FenceStatus } from './types';

const DB_VERSION = 5;

// Multi-tenant: each farm gets its own IndexedDB so switching farms in the
// same browser never leaks data across tenants.
let _activeFarmSlug: string | null = null;

// ── farmEpoch — monotonic counter for cross-tenant cache invalidation (M4) ───
//
// Every call to setActiveFarmSlug bumps this counter. Epoch-aware read helpers
// (getCachedCampsForEpoch, getCachedFarmSettingsForEpoch) compare the caller's
// snapshot against the current epoch and return null if they diverge — this
// prevents any in-flight Promise that resolved AFTER a farm switch from
// delivering stale-tenant data into the new farm's UI.
//
// The epoch is a plain module-level number so the check is always synchronous,
// which eliminates the race window between "read epoch" and "read IDB value".
let _farmEpoch = 0;

export function setActiveFarmSlug(slug: string): void {
  _activeFarmSlug = slug;
  // Bump epoch synchronously so any subsequent getFarmEpoch() sees the new value
  // before any async IDB operation can complete.
  _farmEpoch += 1;
}

/** Returns the current farm epoch. Synchronous — safe to read in render. */
export function getFarmEpoch(): number {
  return _farmEpoch;
}

function getDBName(): string {
  if (_activeFarmSlug) {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('activeFarmSlug', _activeFarmSlug);
    return `farmtrack-${_activeFarmSlug}`;
  }
  if (typeof window !== 'undefined') {
    // Restore after a hard reload before OfflineProvider has mounted
    const stored = sessionStorage.getItem('activeFarmSlug');
    if (stored) return `farmtrack-${stored}`;
    const seg = window.location.pathname.split('/')[1];
    if (seg) return `farmtrack-${seg}`;
  }
  throw new Error('No active farm slug — call setActiveFarmSlug() before using offline-store');
}

/**
 * Issue #208 — failure metadata that every queued-row shape carries.
 *
 * `attempts` increments on every sync attempt (pass OR fail) so the UI can
 * show "synced after N tries" / "failed after N tries". `firstFailedAt`
 * captures the FIRST transition pending → failed and is then frozen so the
 * dead-letter UI can show "stuck since…" (#209 retry-from-UI consumes this).
 * `lastError` / `lastStatusCode` carry the most recent failure's diagnostics
 * for the dead-letter dialog.
 *
 * All four fields default at read time when missing from the on-disk row,
 * so legacy records written by a pre-#208 build still deserialise cleanly
 * without an IDB schema bump.
 */
export interface PendingQueueFailureMeta {
  /** Increments on every sync attempt — success OR failure. */
  attempts: number;
  /** Truncated response body or thrown-error message from the most recent failure. */
  lastError: string | null;
  /** Epoch-ms of the FIRST transition pending → failed; never overwritten. */
  firstFailedAt: number | null;
  /** HTTP status of the most recent failure; null if fetch threw. */
  lastStatusCode: number | null;
}

export interface PendingObservation extends PendingQueueFailureMeta {
  local_id?: number;
  type: string;
  camp_id: string;
  animal_id?: string;
  details: string; // JSON string
  created_at: string; // ISO
  synced_at: string | null;
  sync_status: 'pending' | 'synced' | 'failed';
  /**
   * Issue #206 — client-generated idempotency key. The form (e.g.
   * `CampConditionForm`) generates this once at mount via `crypto.randomUUID()`.
   * The sync queue replays it VERBATIM on every retry; the server upserts on
   * `Observation.clientLocalId` so duplicate POSTs collapse to a single row.
   *
   * Optional for two reasons:
   *   1. Back-compat — rows queued before this slice landed have no UUID.
   *   2. #207 (Animal + Cover) will extend the same pattern to other form
   *      payloads; until each Logger handler is wired, rows for those types
   *      may still arrive without a key.
   *
   * Once set, this field MUST NOT be regenerated on replay — that would
   * defeat the entire idempotency contract.
   */
  clientLocalId?: string;
}

export interface PendingAnimalCreate extends PendingQueueFailureMeta {
  local_id?: number;
  animal_id: string;        // temp ID e.g. "KALF-1710000000000"
  name?: string;
  sex: string;              // "Male" | "Female"
  category: string;         // "Calf"
  current_camp: string;
  mother_id?: string;
  date_added: string;       // ISO date
  sync_status: 'pending' | 'synced' | 'failed';
  /**
   * Issue #207 — client-generated idempotency key. Form / queue helper
   * generates this once at the moment of capture; the sync queue replays it
   * VERBATIM on every retry; the server upserts on `Animal.clientLocalId`
   * so duplicate POSTs collapse to a single row. Optional for back-compat
   * with rows queued pre-#207. Once set, MUST NOT be regenerated on replay.
   */
  clientLocalId?: string;
}

function getDB(): Promise<IDBPDatabase> {
  return openDB(getDBName(), DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains('camps')) {
          db.createObjectStore('camps', { keyPath: 'camp_id' });
        }
        if (!db.objectStoreNames.contains('animals')) {
          const animalsStore = db.createObjectStore('animals', { keyPath: 'animal_id' });
          animalsStore.createIndex('camp', 'current_camp');
        }
        if (!db.objectStoreNames.contains('pending_observations')) {
          db.createObjectStore('pending_observations', { keyPath: 'local_id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      }
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains('pending_animal_creates')) {
          db.createObjectStore('pending_animal_creates', { keyPath: 'local_id', autoIncrement: true });
        }
      }
      if (oldVersion < 3) {
        if (!db.objectStoreNames.contains('pending_photos')) {
          const photosStore = db.createObjectStore('pending_photos', { keyPath: 'local_id', autoIncrement: true });
          photosStore.createIndex('by_observation', 'observation_local_id', { unique: false });
          photosStore.createIndex('by_sync_status', 'sync_status', { unique: false });
        }
        if (!db.objectStoreNames.contains('tasks')) {
          db.createObjectStore('tasks', { keyPath: 'id' });
        }
      }
      if (oldVersion < 4) {
        // Markers for animals with a locally-applied but not-yet-pushed mutation
        // (status change, camp move). Keyed by animal_id so we can O(1) check
        // during orphan-sweep in seedAnimals without scanning.
        if (!db.objectStoreNames.contains('pending_animal_updates')) {
          db.createObjectStore('pending_animal_updates', { keyPath: 'animal_id' });
        }
      }
      if (oldVersion < 5) {
        // Offline pasture-cover readings. Separate from pending_observations
        // because CampCoverReading is a typed domain object (kgDmPerHa,
        // useFactor, daysRemaining) that the FeedOnOffer page queries directly
        // — it cannot be collapsed into the generic observation JSON blob.
        if (!db.objectStoreNames.contains('pending_cover_readings')) {
          db.createObjectStore('pending_cover_readings', { keyPath: 'local_id', autoIncrement: true });
        }
      }
    },
  });
}

export async function seedCamps(camps: Camp[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('camps', 'readwrite');

  // Read existing records to (a) preserve locally-set condition fields and (b) detect orphans
  const existing = await tx.store.getAll();
  const existingMap = new Map(existing.map((c) => [c.camp_id, c]));
  const incomingIds = new Set(camps.map((c) => c.camp_id));

  // Upsert each incoming camp.
  // If the incoming camp already carries server-authoritative condition fields
  // (merged in by refreshCachedData → /api/camps/status), those win.
  // If the incoming camp has no condition data (server didn't provide any for this
  // camp), fall back to whatever was already in IDB so local observations are
  // not silently wiped on every refresh.
  for (const camp of camps) {
    const prev = existingMap.get(camp.camp_id);
    const merged: Camp = prev
      ? {
          ...camp,
          grazing_quality: camp.grazing_quality ?? prev.grazing_quality,
          water_status: camp.water_status ?? prev.water_status,
          fence_status: camp.fence_status ?? prev.fence_status,
          last_inspected_at: camp.last_inspected_at ?? prev.last_inspected_at,
          last_inspected_by: camp.last_inspected_by ?? prev.last_inspected_by,
        }
      : camp;
    await tx.store.put(merged);
  }

  // Delete camps removed from the server so they don't persist in the logger (Bug A fix)
  for (const key of existingMap.keys()) {
    if (!incomingIds.has(key)) {
      await tx.store.delete(key);
    }
  }

  await tx.done;
}

export async function getCachedCamps(): Promise<Camp[]> {
  const db = await getDB();
  return db.getAll('camps');
}

/**
 * Epoch-aware variant of getCachedCamps (M4).
 *
 * Returns null if the caller's epoch snapshot no longer matches the current
 * epoch — meaning setActiveFarmSlug was called after the caller captured the
 * epoch, so the IDB data belongs to a different tenant context.
 *
 * Usage:
 *   const epoch = getFarmEpoch();   // capture synchronously before any await
 *   const camps = await getCachedCampsForEpoch(epoch);
 *   if (camps === null) return; // farm switched mid-flight — discard
 */
export async function getCachedCampsForEpoch(epoch: number): Promise<Camp[] | null> {
  const db = await getDB();
  if (epoch !== _farmEpoch) return null;
  const camps = await db.getAll('camps');
  // Re-check after the async IDB read in case another switch happened mid-await
  if (epoch !== _farmEpoch) return null;
  return camps;
}

export async function seedAnimals(animals: Animal[]): Promise<void> {
  // Defensive early-return: a transient API failure or pagination bug that
  // returns an empty list must NOT orphan-sweep the whole local cache. A
  // genuinely-zero-animals farm is rare and would still heal on the next
  // non-empty refresh; the inverse mistake (wiping a live herd) is not
  // recoverable on the device.
  if (animals.length === 0) return;

  const db = await getDB();

  // Collect the set of animal_ids with a pending local mutation BEFORE we
  // open the write transaction on `animals`. The `idb` library only permits a
  // single object store per `transaction()` call here (we don't depend on
  // cross-store atomicity since orphan-sweep and queue-read are idempotent).
  const pendingIds = new Set(await getPendingAnimalUpdateIds());

  const tx = db.transaction('animals', 'readwrite');
  const existingKeys = (await tx.store.getAllKeys()) as string[];
  const incomingIds = new Set(animals.map((a) => a.animal_id));

  for (const animal of animals) {
    await tx.store.put(animal);
  }

  // Delete animals the server no longer returns, EXCEPT any row whose
  // animal_id is still in the pending_animal_updates queue — those represent
  // offline edits that haven't yet been pushed. Deleting them here would
  // silently lose the user's work.
  for (const key of existingKeys) {
    if (incomingIds.has(key)) continue;
    if (pendingIds.has(key)) continue;
    await tx.store.delete(key);
  }

  await tx.done;
}

export async function getAnimalsByCampCached(campId: string): Promise<Animal[]> {
  const db = await getDB();
  return db.getAllFromIndex('animals', 'camp', campId);
}

/**
 * Issue #208 — read-time defaulting for legacy rows. A row written by a
 * pre-#208 build has no `attempts` / `lastError` / `firstFailedAt` /
 * `lastStatusCode` fields. Rather than schema-migrating (which would force a
 * coordinated rollout across every offline device), we default the missing
 * fields here so every accessor returns a fully-typed row.
 */
function withDefaultedFailureMeta<T extends Partial<PendingQueueFailureMeta>>(
  row: T,
): T & PendingQueueFailureMeta {
  return {
    ...row,
    attempts: typeof row.attempts === 'number' ? row.attempts : 0,
    lastError: row.lastError ?? null,
    firstFailedAt: row.firstFailedAt ?? null,
    lastStatusCode: row.lastStatusCode ?? null,
  };
}

/**
 * Failure-metadata payload accepted by every `markXFailed` helper. Captured
 * by `sync-manager.ts` on each non-2xx / fetch-throw and persisted onto the
 * queued row so the #209 dead-letter UI can render "stuck since…", retry,
 * and surface the truncated server response.
 */
export interface QueueRowFailureInput {
  /** HTTP status of the failed attempt; null when fetch threw before a response arrived. */
  statusCode: number | null;
  /** Truncated response body or thrown-error message. Caller truncates. */
  error: string;
}

/**
 * Internal — apply a failure transition to any queued row. Increments
 * `attempts`, stamps `firstFailedAt` only on the FIRST failure, and stores
 * the most recent `lastError` / `lastStatusCode`. The single-writer shape
 * keeps the three queue handlers identical and forces the firstFailedAt
 * invariant to be expressed in exactly one place.
 */
function applyFailureMeta<T extends PendingQueueFailureMeta>(
  row: T,
  meta: QueueRowFailureInput,
): T {
  const defaulted = withDefaultedFailureMeta(row);
  return {
    ...defaulted,
    sync_status: 'failed' as const,
    attempts: defaulted.attempts + 1,
    lastError: meta.error,
    lastStatusCode: meta.statusCode,
    firstFailedAt: defaulted.firstFailedAt ?? Date.now(),
  };
}

/**
 * Internal — apply a success transition. Increments `attempts` so the UI can
 * report "synced after N tries", clears every failure-metadata field, and
 * flips the row to `synced`.
 */
function applySuccessMeta<T extends PendingQueueFailureMeta>(row: T): T {
  const defaulted = withDefaultedFailureMeta(row);
  return {
    ...defaulted,
    sync_status: 'synced' as const,
    attempts: defaulted.attempts + 1,
    lastError: null,
    lastStatusCode: null,
    firstFailedAt: null,
  };
}

/**
 * Issue #209 — apply a "re-queued for retry" transition. Flips status back to
 * `pending` so the next sync cycle picks the row up, but DELIBERATELY leaves
 * `attempts`, `firstFailedAt`, `lastError`, `lastStatusCode` untouched:
 *
 *   - `attempts` is audit history. The user pressing Retry doesn't make the
 *     row's third attempt the new "first". We bump `attempts` only on the
 *     actual sync attempt (`applySuccessMeta` / `applyFailureMeta`), never on
 *     the local re-queue.
 *   - `firstFailedAt` answers "stuck since…" — if the user retries and the
 *     row fails again, the stuck-since time should reflect the original
 *     failure, not the most recent re-queue.
 *   - `lastError` / `lastStatusCode` stay visible in the dead-letter UI even
 *     after re-queueing so the user can keep the context while watching the
 *     sync attempt fly. They are cleared by `applySuccessMeta` only if the
 *     retry actually succeeds.
 *
 * The single-writer shape mirrors `applyFailureMeta` so the three per-kind
 * helpers (`markObservationPending`, `markAnimalCreatePending`,
 * `markCoverReadingPending`) cannot drift from one another.
 */
function applyPendingMeta<T extends PendingQueueFailureMeta>(row: T): T {
  const defaulted = withDefaultedFailureMeta(row);
  return {
    ...defaulted,
    sync_status: 'pending' as const,
  };
}

/**
 * Issue #208 — enqueue payload. Callers (forms, sync helpers, tests) do NOT
 * supply `attempts` / `lastError` / `firstFailedAt` / `lastStatusCode`;
 * `queueObservation` fills them via `withDefaultedFailureMeta` so every row
 * on disk has the metadata fields from the moment it lands in IDB. Callers
 * may still supply them (e.g. fixtures, ops scripts) — the helper only fills
 * missing slots.
 */
export type QueueObservationInput = Omit<
  PendingObservation,
  'local_id' | keyof PendingQueueFailureMeta
> &
  Partial<PendingQueueFailureMeta>;

export async function queueObservation(obs: QueueObservationInput): Promise<number> {
  const db = await getDB();
  return db.add('pending_observations', withDefaultedFailureMeta(obs)) as Promise<number>;
}

export async function getPendingObservations(): Promise<PendingObservation[]> {
  const db = await getDB();
  const all = await db.getAll('pending_observations');
  // Issue #208 — return ONLY pending rows. Failed rows are now in their own
  // bucket (`getFailedObservations`) and are not auto-retried; #209's
  // retry-from-UI flips them back to `pending` explicitly.
  return all
    .filter((o) => o.sync_status === 'pending')
    .map((o) => withDefaultedFailureMeta(o as PendingObservation));
}

/** Issue #208 — failed-bucket accessor for the #209 dead-letter UI. */
export async function getFailedObservations(): Promise<PendingObservation[]> {
  const db = await getDB();
  const all = await db.getAll('pending_observations');
  return all
    .filter((o) => o.sync_status === 'failed')
    .map((o) => withDefaultedFailureMeta(o as PendingObservation));
}

export async function markObservationSynced(localId: number): Promise<void> {
  const db = await getDB();
  const obs = await db.get('pending_observations', localId);
  if (obs) {
    await db.put('pending_observations', {
      ...applySuccessMeta(obs as PendingObservation),
      synced_at: new Date().toISOString(),
    });
  }
}

export async function markObservationFailed(
  localId: number,
  meta: QueueRowFailureInput,
): Promise<void> {
  const db = await getDB();
  const obs = await db.get('pending_observations', localId);
  if (obs) {
    await db.put('pending_observations', applyFailureMeta(obs as PendingObservation, meta));
  }
}

/**
 * Issue #209 — flip a previously-failed observation back to `pending` so the
 * next sync cycle retries it. Crucially, `clientLocalId` and the entire
 * failure-metadata block are preserved by `applyPendingMeta`: the retry POST
 * carries the same UUID the original attempt did, which is what makes the
 * server-side upsert (#206) collapse a re-attempted row to a single canonical
 * server row even if a previous attempt was actually received but the
 * response was lost in transit. Audit history (`attempts`, `firstFailedAt`,
 * `lastError`, `lastStatusCode`) intentionally remains on the row so the
 * dead-letter UI can show "attempted N times" after a successful retry.
 */
export async function markObservationPending(localId: number): Promise<void> {
  const db = await getDB();
  const obs = await db.get('pending_observations', localId);
  if (obs) {
    await db.put('pending_observations', applyPendingMeta(obs as PendingObservation));
  }
}

export async function getPendingCount(): Promise<number> {
  // Issue #208 — pendingCount tallies only rows in the strict pending bucket
  // (synced rows are excluded by getPendingX; failed rows are now excluded
  // too). This is the fix for the perpetual "N pending" pill that never
  // drained when rows were failing.
  const [pending, pendingAnimals, pendingCovers] = await Promise.all([
    getPendingObservations(),
    getPendingAnimalCreates(),
    getPendingCoverReadings(),
  ]);
  return pending.length + pendingAnimals.length + pendingCovers.length;
}

/**
 * Issue #208 — failed-row tally across all three pending-payload queues.
 * Mirrors `getPendingCount` so the UI can surface a "N failed" counter
 * (#209). Excludes photos because photo failures are a transport
 * implementation detail and are not user-actionable independently of the
 * parent observation.
 */
export async function getFailedCount(): Promise<number> {
  const [failedObs, failedAnimals, failedCovers] = await Promise.all([
    getFailedObservations(),
    getFailedAnimals(),
    getFailedCoverReadings(),
  ]);
  return failedObs.length + failedAnimals.length + failedCovers.length;
}

/**
 * Generic metadata read for the sync queue facade (PRD #194, `@/lib/sync/queue`).
 *
 * The `metadata` object store is keyed by `{ key, value: string }` records.
 * `lib/sync/queue.ts` persists its `lastAttemptAt` / `lastFullSuccessAt`
 * timestamps here so the truth survives reloads. The legacy `lastSyncedAt`
 * key, plus its direct getter / setter / epoch-aware variant, were deleted in
 * wave 3 (#197) — UI consumers read `getCurrentSyncTruth()` from the facade
 * instead. See docs/adr/0002-client-side-sync-state.md.
 *
 * Returns `null` when the key is absent OR the active farm slug isn't set
 * (e.g. SSR — sync-manager only runs in the browser, but defensive null is
 * safer than throwing).
 */
export async function getSyncMetadataValue(key: string): Promise<string | null> {
  try {
    const db = await getDB();
    const meta = await db.get('metadata', key);
    return (meta as { key: string; value: string } | undefined)?.value ?? null;
  } catch {
    return null;
  }
}

/** Generic metadata write — paired with `getSyncMetadataValue`. */
export async function setSyncMetadataValue(key: string, value: string): Promise<void> {
  const db = await getDB();
  await db.put('metadata', { key, value });
}

// ── Failed-row counters (sync queue facade) ──────────────────────────────────
//
// Each pending-* store already tags rows with `sync_status: 'pending' | 'synced'
// | 'failed'`. The queue facade derives `failedCount` for `SyncTruth` from a
// live count of `failed` rows across all four stores. Synced rows are kept
// until next refresh for diagnostic purposes, so we filter explicitly rather
// than counting `getPendingXxx().length` (which already includes `failed`).

export async function getFailedObservationsCount(): Promise<number> {
  const db = await getDB();
  const all = await db.getAll('pending_observations');
  return all.filter((o) => o.sync_status === 'failed').length;
}

export async function getFailedAnimalCreatesCount(): Promise<number> {
  const db = await getDB();
  const all = await db.getAll('pending_animal_creates');
  return all.filter((a) => a.sync_status === 'failed').length;
}

export async function getFailedCoverReadingsCount(): Promise<number> {
  const db = await getDB();
  const all = await db.getAll('pending_cover_readings');
  return all.filter((r) => r.sync_status === 'failed').length;
}

export async function getFailedPhotosCount(): Promise<number> {
  const db = await getDB();
  const all = await db.getAll('pending_photos');
  return all.filter((p) => p.sync_status === 'failed').length;
}

export interface CachedFarmSettings {
  farmName: string;
  breed: string;
  // heroImageUrl is intentionally absent from the persisted cache (M3).
  // The background image is always /farm-hero.jpg — a single shared asset.
  // Storing a per-tenant URL here created a cross-tenant cache-leak vector
  // when the IDB metadata store was read before setActiveFarmSlug completed.
  // Callers that need the fallback URL should use: settings?.heroImageUrl ?? '/farm-hero.jpg'
  // but the value will always be undefined from the cache layer onward.
  /** @deprecated — not stored. Always falls back to /farm-hero.jpg at the call site. */
  heroImageUrl?: never;
}

export async function seedFarmSettings(settings: Omit<CachedFarmSettings, 'heroImageUrl'> & { heroImageUrl?: string }): Promise<void> {
  // M3: strip heroImageUrl before persisting — the background image is always
  // /farm-hero.jpg. Accepting the field in the signature avoids a TS error at
  // existing call sites (sync-manager passes heroImageUrl from /api/farm) while
  // silently discarding it, which is the correct behaviour.
  const { heroImageUrl: _dropped, ...safe } = settings;
  void _dropped; // explicitly unused — discarded intentionally
  const db = await getDB();
  await db.put('metadata', { key: 'farmSettings', value: JSON.stringify(safe) });
}

export async function getCachedFarmSettings(): Promise<CachedFarmSettings | null> {
  const db = await getDB();
  const meta = await db.get('metadata', 'farmSettings');
  if (!meta) return null;
  try {
    return JSON.parse((meta as { key: string; value: string }).value) as CachedFarmSettings;
  } catch {
    return null;
  }
}

/**
 * Epoch-aware variant of getCachedFarmSettings (M4).
 * Returns null if the epoch is stale (farm switched since caller captured it).
 */
export async function getCachedFarmSettingsForEpoch(epoch: number): Promise<CachedFarmSettings | null> {
  if (epoch !== _farmEpoch) return null;
  const result = await getCachedFarmSettings();
  if (epoch !== _farmEpoch) return null;
  return result;
}

export async function updateCampCondition(
  campId: string,
  condition: {
    grazing_quality?: GrazingQuality;
    water_status?: WaterStatus;
    fence_status?: FenceStatus;
    last_inspected_at?: string;
    last_inspected_by?: string;
  },
): Promise<void> {
  const db = await getDB();
  const camp = await db.get('camps', campId);
  if (camp) {
    await db.put('camps', { ...camp, ...condition });
  }
}

export async function updateAnimalCamp(animalId: string, newCampId: string): Promise<void> {
  const db = await getDB();
  const animal = await db.get('animals', animalId);
  if (animal) {
    await db.put('animals', { ...animal, current_camp: newCampId });
    // Mark this animal as having a locally-applied mutation so the next
    // full refresh doesn't orphan-sweep it before the server catches up.
    await queuePendingAnimalUpdate(animalId);
  }
}

export async function updateAnimalStatus(animalId: string, status: AnimalStatus): Promise<void> {
  const db = await getDB();
  const animal = await db.get('animals', animalId);
  if (animal) {
    await db.put('animals', { ...animal, status });
    await queuePendingAnimalUpdate(animalId);
  }
}

// ── Pending Animal Updates (offline camp-move / status-change markers) ────────
//
// These are NOT a transport queue — the actual mutation is carried by the
// pending `Observation` (e.g. a `camp_move` or `status_change` observation).
// This store is just a set of animal_ids that have a local edit outstanding,
// so `seedAnimals` knows not to delete them during orphan-cleanup.

export async function queuePendingAnimalUpdate(animalId: string): Promise<void> {
  const db = await getDB();
  await db.put('pending_animal_updates', { animal_id: animalId });
}

export async function getPendingAnimalUpdateIds(): Promise<string[]> {
  const db = await getDB();
  const rows = (await db.getAll('pending_animal_updates')) as Array<{ animal_id: string }>;
  return rows.map((r) => r.animal_id);
}

export async function clearPendingAnimalUpdate(animalId: string): Promise<void> {
  const db = await getDB();
  await db.delete('pending_animal_updates', animalId);
}

export async function clearAllPendingAnimalUpdates(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('pending_animal_updates', 'readwrite');
  await tx.store.clear();
  await tx.done;
}

// ── Pending Animal Creates (offline calving) ─────────────────────────────────

export type QueueAnimalCreateInput = Omit<
  PendingAnimalCreate,
  'local_id' | keyof PendingQueueFailureMeta
> &
  Partial<PendingQueueFailureMeta>;

export async function queueAnimalCreate(animal: QueueAnimalCreateInput): Promise<number> {
  const db = await getDB();
  return db.add('pending_animal_creates', withDefaultedFailureMeta(animal)) as Promise<number>;
}

export async function getPendingAnimalCreates(): Promise<PendingAnimalCreate[]> {
  const db = await getDB();
  const all = await db.getAll('pending_animal_creates');
  return all
    .filter((a) => a.sync_status === 'pending')
    .map((a) => withDefaultedFailureMeta(a as PendingAnimalCreate));
}

/** Issue #208 — failed-bucket accessor; symmetric to getPendingAnimalCreates. */
export async function getFailedAnimals(): Promise<PendingAnimalCreate[]> {
  const db = await getDB();
  const all = await db.getAll('pending_animal_creates');
  return all
    .filter((a) => a.sync_status === 'failed')
    .map((a) => withDefaultedFailureMeta(a as PendingAnimalCreate));
}

export async function markAnimalCreateSynced(localId: number): Promise<void> {
  const db = await getDB();
  const rec = await db.get('pending_animal_creates', localId);
  if (rec) {
    await db.put('pending_animal_creates', applySuccessMeta(rec as PendingAnimalCreate));
  }
}

export async function markAnimalCreateFailed(
  localId: number,
  meta: QueueRowFailureInput,
): Promise<void> {
  const db = await getDB();
  const rec = await db.get('pending_animal_creates', localId);
  if (rec) {
    await db.put(
      'pending_animal_creates',
      applyFailureMeta(rec as PendingAnimalCreate, meta),
    );
  }
}

/** Issue #209 — symmetric to `markObservationPending`. See its doc-comment. */
export async function markAnimalCreatePending(localId: number): Promise<void> {
  const db = await getDB();
  const rec = await db.get('pending_animal_creates', localId);
  if (rec) {
    await db.put(
      'pending_animal_creates',
      applyPendingMeta(rec as PendingAnimalCreate),
    );
  }
}

// ── Pending Photos (offline photo capture) ───────────────────────────────────

export interface PendingPhoto {
  local_id?: number;
  // Always the numeric IDB local_id returned by queueObservation — never a
  // server-assigned string ID. Narrowed from string|number to number so the
  // sync loop can look it up in localToServerId without a type-switch.
  observation_local_id: number;
  blob: Blob;
  // Populated after a successful upload to Vercel Blob. If set, the upload
  // step is skipped on retry so we don't create duplicate blobs.
  blob_url?: string;
  sync_status: 'pending' | 'synced' | 'failed';
}

export async function queuePhoto(observationLocalId: number, blob: Blob): Promise<number> {
  const db = await getDB();
  return db.add('pending_photos', {
    observation_local_id: observationLocalId,
    blob,
    sync_status: 'pending',
  }) as Promise<number>;
}

export async function getPendingPhotos(): Promise<PendingPhoto[]> {
  const db = await getDB();
  const all = await db.getAll('pending_photos');
  return all.filter((p) => p.sync_status === 'pending' || p.sync_status === 'failed');
}

export async function markPhotoSynced(localId: number): Promise<void> {
  const db = await getDB();
  const photo = await db.get('pending_photos', localId);
  if (photo) {
    await db.put('pending_photos', { ...photo, sync_status: 'synced' });
  }
}

// Persists the uploaded blob URL without flipping sync_status so the
// attachment PATCH can be retried independently if it fails.
export async function markPhotoUploaded(localId: number, url: string): Promise<void> {
  const db = await getDB();
  const photo = await db.get('pending_photos', localId);
  if (photo) {
    await db.put('pending_photos', { ...photo, blob_url: url });
  }
}

export async function markPhotoFailed(localId: number): Promise<void> {
  const db = await getDB();
  const photo = await db.get('pending_photos', localId);
  if (photo) {
    await db.put('pending_photos', { ...photo, sync_status: 'failed' });
  }
}

export async function getPhotoForObservation(observationLocalId: number): Promise<Blob | null> {
  const db = await getDB();
  const results = await db.getAllFromIndex('pending_photos', 'by_observation', observationLocalId);
  const pending = results.find((p) => p.sync_status === 'pending' || p.sync_status === 'failed');
  return pending?.blob ?? null;
}

// ── Pending Cover Readings (offline pasture-cover logging) ───────────────────

export interface PendingCoverReading extends PendingQueueFailureMeta {
  local_id?: number;
  farm_slug: string;
  camp_id: string;
  cover_category: 'Good' | 'Fair' | 'Poor';
  created_at: string; // ISO
  photo_blob?: Blob;
  // Populated after a successful cover-reading POST so a subsequent photo
  // attachment PATCH can retry without re-creating the reading row.
  server_reading_id?: string;
  sync_status: 'pending' | 'synced' | 'failed';
  /**
   * Issue #207 — client-generated idempotency key. Form / queue helper
   * generates this once at capture; the sync queue replays it VERBATIM on
   * every retry; the server upserts on `CampCoverReading.clientLocalId` so
   * duplicate POSTs collapse to a single row. Optional for back-compat with
   * rows queued pre-#207. Once set, MUST NOT be regenerated on replay.
   *
   * Note: `server_reading_id` already protects against re-creating the row
   * on a known-succeeded POST. `clientLocalId` is the complementary safety
   * net for the "client thought POST failed but server got it" race — the
   * canonical class of bug the idempotency contract exists to absorb.
   */
  clientLocalId?: string;
}

export type QueueCoverReadingInput = Omit<
  PendingCoverReading,
  'local_id' | keyof PendingQueueFailureMeta
> &
  Partial<PendingQueueFailureMeta>;

export async function queueCoverReading(reading: QueueCoverReadingInput): Promise<number> {
  const db = await getDB();
  return db.add('pending_cover_readings', withDefaultedFailureMeta(reading)) as Promise<number>;
}

export async function getPendingCoverReadings(): Promise<PendingCoverReading[]> {
  const db = await getDB();
  const all = await db.getAll('pending_cover_readings');
  return all
    .filter((r) => r.sync_status === 'pending')
    .map((r) => withDefaultedFailureMeta(r as PendingCoverReading));
}

/** Issue #208 — failed-bucket accessor; symmetric to getPendingCoverReadings. */
export async function getFailedCoverReadings(): Promise<PendingCoverReading[]> {
  const db = await getDB();
  const all = await db.getAll('pending_cover_readings');
  return all
    .filter((r) => r.sync_status === 'failed')
    .map((r) => withDefaultedFailureMeta(r as PendingCoverReading));
}

export async function markCoverReadingSynced(localId: number): Promise<void> {
  const db = await getDB();
  const rec = await db.get('pending_cover_readings', localId);
  if (rec) {
    await db.put('pending_cover_readings', applySuccessMeta(rec as PendingCoverReading));
  }
}

export async function markCoverReadingFailed(
  localId: number,
  meta: QueueRowFailureInput,
): Promise<void> {
  const db = await getDB();
  const rec = await db.get('pending_cover_readings', localId);
  if (rec) {
    await db.put(
      'pending_cover_readings',
      applyFailureMeta(rec as PendingCoverReading, meta),
    );
  }
}

/** Issue #209 — symmetric to `markObservationPending`. See its doc-comment. */
export async function markCoverReadingPending(localId: number): Promise<void> {
  const db = await getDB();
  const rec = await db.get('pending_cover_readings', localId);
  if (rec) {
    await db.put(
      'pending_cover_readings',
      applyPendingMeta(rec as PendingCoverReading),
    );
  }
}

export async function markCoverReadingPosted(localId: number, serverId: string): Promise<void> {
  const db = await getDB();
  const rec = await db.get('pending_cover_readings', localId);
  if (rec) {
    await db.put('pending_cover_readings', { ...rec, server_reading_id: serverId });
  }
}

export async function getPendingCoverReadingCount(): Promise<number> {
  const readings = await getPendingCoverReadings();
  return readings.length;
}
