import { openDB, IDBPDatabase } from 'idb';
import { Camp, Animal, AnimalStatus, GrazingQuality, WaterStatus, FenceStatus } from './types';

const DB_NAME = 'trio-b-offline-db';
const DB_VERSION = 2;

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
  return openDB(DB_NAME, DB_VERSION, {
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
    },
  });
}

export async function seedCamps(camps: Camp[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('camps', 'readwrite');
  await Promise.all(camps.map((c) => tx.store.put(c)));
  await tx.done;
}

export async function getCachedCamps(): Promise<Camp[]> {
  const db = await getDB();
  return db.getAll('camps');
}

export async function seedAnimals(animals: Animal[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('animals', 'readwrite');
  await Promise.all(animals.map((a) => tx.store.put(a)));
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
