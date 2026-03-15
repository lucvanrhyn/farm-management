import {
  seedCamps,
  seedAnimals,
  getPendingObservations,
  markObservationSynced,
  markObservationFailed,
  setLastSyncedAt,
  PendingObservation,
} from './offline-store';
import type { Camp, Animal, AnimalSex } from './types';
import type { PrismaAnimal } from './types';

export async function refreshCachedData(): Promise<void> {
  const [campsRes, animalsRes] = await Promise.all([
    fetch('/api/camps'),
    fetch('/api/animals'),
  ]);

  if (campsRes.ok) {
    const camps: Camp[] = await campsRes.json();
    await seedCamps(camps);
  }

  if (animalsRes.ok) {
    const prismaAnimals: PrismaAnimal[] = await animalsRes.json();
    const animals: Animal[] = prismaAnimals.map((a) => ({
      animal_id: a.animalId,
      name: a.name ?? undefined,
      sex: a.sex as AnimalSex,
      date_of_birth: a.dateOfBirth ?? undefined,
      breed: a.breed,
      category: a.category,
      current_camp: a.currentCamp,
      status: a.status,
      mother_id: a.motherId ?? undefined,
      father_id: a.fatherId ?? undefined,
      notes: a.notes ?? undefined,
      date_added: a.dateAdded,
    }));
    await seedAnimals(animals);
  }

  await setLastSyncedAt(new Date().toISOString());
}

async function uploadObservation(obs: PendingObservation): Promise<boolean> {
  try {
    const res = await fetch('/api/observations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function syncPendingObservations(): Promise<{ synced: number; failed: number }> {
  const pending = await getPendingObservations();
  let synced = 0;
  let failed = 0;

  for (const obs of pending) {
    const ok = await uploadObservation(obs);
    if (ok) {
      await markObservationSynced(obs.local_id!);
      synced++;
    } else {
      await markObservationFailed(obs.local_id!);
      failed++;
    }
  }

  return { synced, failed };
}
