import { openDB, IDBPDatabase } from 'idb';
import { Camp, Animal, AnimalStatus, GrazingQuality, WaterStatus, FenceStatus } from './types';

const DB_VERSION = 5;

// Multi-tenant: each farm gets its own IndexedDB so switching farms in the
// same browser never leaks data across tenants.
let _activeFarmSlug: string | null = null;

// ── farmEpoch — monotonic counter for cross-tenant cache invalidation (M4) ───
//
// Every call to setActiveFarmSlug bumps this counter. Epoch-aware read helpers
// (getCachedCampsForEpoch, getLastSyncedAtForEpoch, getCachedFarmSettingsForEpoch)
// compare the caller's snapshot against the current epoch and return null if they
// diverge — this prevents any in-flight Promise that resolved AFTER a farm switch
// from delivering stale-tenant data into the new farm's UI.
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

export interface PendingObservation {
  local_id?: number;
  type: string;
  camp_id: string;
  animal_id?: string;
  details: string; // JSON string
  created_at: string; // ISO
  synced_at: string | null;
  sync_status: 'pending' | 'synced' | 'failed';
}

export interface PendingAnimalCreate {
  local_id?: number;
  animal_id: string;        // temp ID e.g. "KALF-1710000000000"
  name?: string;
  sex: string;              // "Male" | "Female"
  category: string;         // "Calf"
  current_camp: string;
  mother_id?: string;
  date_added: string;       // ISO date
  sync_status: 'pending' | 'synced' | 'failed';
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

export async function queueObservation(
  obs: Omit<PendingObservation, 'local_id'>,
): Promise<number> {
  const db = await getDB();
  return db.add('pending_observations', obs) as Promise<number>;
}

export async function getPendingObservations(): Promise<PendingObservation[]> {
  const db = await getDB();
  const all = await db.getAll('pending_observations');
  // Include 'failed' so transient failures are retried on the next sync attempt
  return all.filter((o) => o.sync_status === 'pending' || o.sync_status === 'failed');
}

export async function markObservationSynced(localId: number): Promise<void> {
  const db = await getDB();
  const obs = await db.get('pending_observations', localId);
  if (obs) {
    await db.put('pending_observations', {
      ...obs,
      sync_status: 'synced',
      synced_at: new Date().toISOString(),
    });
  }
}

export async function markObservationFailed(localId: number): Promise<void> {
  const db = await getDB();
  const obs = await db.get('pending_observations', localId);
  if (obs) {
    await db.put('pending_observations', { ...obs, sync_status: 'failed' });
  }
}

export async function getPendingCount(): Promise<number> {
  const [pending, pendingAnimals, pendingCovers] = await Promise.all([
    getPendingObservations(),
    getPendingAnimalCreates(),
    getPendingCoverReadings(),
  ]);
  return pending.length + pendingAnimals.length + pendingCovers.length;
}

export async function getLastSyncedAt(): Promise<string | null> {
  const db = await getDB();
  const meta = await db.get('metadata', 'lastSyncedAt');
  return (meta as { key: string; value: string } | undefined)?.value ?? null;
}

/**
 * Epoch-aware variant of getLastSyncedAt (M4).
 * Returns null if the epoch is stale (farm switched since caller captured it).
 */
export async function getLastSyncedAtForEpoch(epoch: number): Promise<string | null> {
  if (epoch !== _farmEpoch) return null;
  const db = await getDB();
  const meta = await db.get('metadata', 'lastSyncedAt');
  if (epoch !== _farmEpoch) return null;
  return (meta as { key: string; value: string } | undefined)?.value ?? null;
}

export async function setLastSyncedAt(iso: string): Promise<void> {
  const db = await getDB();
  await db.put('metadata', { key: 'lastSyncedAt', value: iso });
}

/**
 * Generic metadata read for the new sync queue facade (PRD #194 wave 1).
 *
 * The `metadata` object store is keyed by `{ key, value: string }` records.
 * `lib/sync/queue.ts` persists its `lastAttemptAt` / `lastFullSuccessAt`
 * timestamps here so the truth survives reloads alongside `lastSyncedAt`.
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

export async function queueAnimalCreate(
  animal: Omit<PendingAnimalCreate, 'local_id'>,
): Promise<number> {
  const db = await getDB();
  return db.add('pending_animal_creates', animal) as Promise<number>;
}

export async function getPendingAnimalCreates(): Promise<PendingAnimalCreate[]> {
  const db = await getDB();
  const all = await db.getAll('pending_animal_creates');
  return all.filter((a) => a.sync_status === 'pending' || a.sync_status === 'failed');
}

export async function markAnimalCreateSynced(localId: number): Promise<void> {
  const db = await getDB();
  const rec = await db.get('pending_animal_creates', localId);
  if (rec) {
    await db.put('pending_animal_creates', { ...rec, sync_status: 'synced' });
  }
}

export async function markAnimalCreateFailed(localId: number): Promise<void> {
  const db = await getDB();
  const rec = await db.get('pending_animal_creates', localId);
  if (rec) {
    await db.put('pending_animal_creates', { ...rec, sync_status: 'failed' });
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

export interface PendingCoverReading {
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
}

export async function queueCoverReading(
  reading: Omit<PendingCoverReading, 'local_id'>,
): Promise<number> {
  const db = await getDB();
  return db.add('pending_cover_readings', reading) as Promise<number>;
}

export async function getPendingCoverReadings(): Promise<PendingCoverReading[]> {
  const db = await getDB();
  const all = await db.getAll('pending_cover_readings');
  return all.filter((r) => r.sync_status === 'pending' || r.sync_status === 'failed');
}

export async function markCoverReadingSynced(localId: number): Promise<void> {
  const db = await getDB();
  const rec = await db.get('pending_cover_readings', localId);
  if (rec) {
    await db.put('pending_cover_readings', { ...rec, sync_status: 'synced' });
  }
}

export async function markCoverReadingFailed(localId: number): Promise<void> {
  const db = await getDB();
  const rec = await db.get('pending_cover_readings', localId);
  if (rec) {
    await db.put('pending_cover_readings', { ...rec, sync_status: 'failed' });
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
