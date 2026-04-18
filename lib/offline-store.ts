import { openDB, IDBPDatabase } from 'idb';
import { Camp, Animal, AnimalStatus, GrazingQuality, WaterStatus, FenceStatus } from './types';

const DB_VERSION = 3;

// Multi-tenant: each farm gets its own IndexedDB so switching farms in the
// same browser never leaks data across tenants.
let _activeFarmSlug: string | null = null;

export function setActiveFarmSlug(slug: string): void {
  _activeFarmSlug = slug;
}

function getDBName(): string {
  if (_activeFarmSlug) return `farmtrack-${_activeFarmSlug}`;
  // Fallback: extract from URL path (e.g. /my-farm/logger → "my-farm")
  if (typeof window !== 'undefined') {
    const seg = window.location.pathname.split('/')[1];
    if (seg) return `farmtrack-${seg}`;
  }
  return 'farmtrack-offline-db';
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

export async function seedAnimals(animals: Animal[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('animals', 'readwrite');

  // Read existing rows so we can (a) detect orphans and (b) preserve any row
  // that still carries a pending local mutation — otherwise a full refresh
  // between an offline edit and its push would silently drop the user's work.
  const existingRows = (await tx.store.getAll()) as Array<
    Animal & { _pendingSync?: boolean }
  >;
  const incomingIds = new Set(animals.map((a) => a.animal_id));

  for (const animal of animals) {
    await tx.store.put(animal);
  }

  // Delete animals removed from the server, except those with a pending local
  // mutation (Bug L1 fix — orphan-cleanup + offline-safety).
  for (const row of existingRows) {
    if (incomingIds.has(row.animal_id)) continue;
    if (row._pendingSync) continue;
    await tx.store.delete(row.animal_id);
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
  const pending = await getPendingObservations();
  const pendingAnimals = await getPendingAnimalCreates();
  return pending.length + pendingAnimals.length;
}

export async function getLastSyncedAt(): Promise<string | null> {
  const db = await getDB();
  const meta = await db.get('metadata', 'lastSyncedAt');
  return (meta as { key: string; value: string } | undefined)?.value ?? null;
}

export async function setLastSyncedAt(iso: string): Promise<void> {
  const db = await getDB();
  await db.put('metadata', { key: 'lastSyncedAt', value: iso });
}

export interface CachedFarmSettings {
  farmName: string;
  breed: string;
}

export async function seedFarmSettings(settings: CachedFarmSettings): Promise<void> {
  const db = await getDB();
  await db.put('metadata', { key: 'farmSettings', value: JSON.stringify(settings) });
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
  }
}

export async function updateAnimalStatus(animalId: string, status: AnimalStatus): Promise<void> {
  const db = await getDB();
  const animal = await db.get('animals', animalId);
  if (animal) {
    await db.put('animals', { ...animal, status });
  }
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
  observation_local_id: string | number;
  blob: Blob;
  sync_status: 'pending' | 'synced' | 'failed';
}

export async function queuePhoto(observationLocalId: string | number, blob: Blob): Promise<number> {
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

export async function getPhotoForObservation(observationLocalId: string | number): Promise<Blob | null> {
  const db = await getDB();
  const results = await db.getAllFromIndex('pending_photos', 'by_observation', observationLocalId);
  const pending = results.find((p) => p.sync_status === 'pending' || p.sync_status === 'failed');
  return pending?.blob ?? null;
}
