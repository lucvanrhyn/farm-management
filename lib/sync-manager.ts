import {
  seedCamps,
  seedAnimals,
  seedFarmSettings,
  getCachedFarmSettings,
  getPendingObservations,
  markObservationSynced,
  markObservationFailed,
  getPendingAnimalCreates,
  markAnimalCreateSynced,
  markAnimalCreateFailed,
  setLastSyncedAt,
  PendingObservation,
  PendingAnimalCreate,
} from './offline-store';
import type { Camp, Animal, AnimalSex, GrazingQuality, WaterStatus, FenceStatus } from './types';
import type { PrismaAnimal } from './types';

interface ServerCampCondition {
  grazing_quality: GrazingQuality;
  water_status: WaterStatus;
  fence_status: FenceStatus;
  last_inspected_at: string;
  last_inspected_by: string | null;
}

export async function refreshCachedData(): Promise<void> {
  const [campsRes, animalsRes, farmRes, statusRes] = await Promise.all([
    fetch('/api/camps'),
    fetch('/api/animals'),
    fetch('/api/farm'),
    fetch('/api/camps/status'),
  ]);

  if (campsRes.ok) {
    const camps: Camp[] = await campsRes.json();

    // Merge server-authoritative condition data so camp colors survive a sync cycle.
    // /api/camps/status returns the latest camp_condition observation per camp.
    if (statusRes.ok) {
      const statusMap: Record<string, ServerCampCondition> = await statusRes.json();
      for (const camp of camps) {
        const serverCondition = statusMap[camp.camp_id];
        if (serverCondition) {
          camp.grazing_quality = serverCondition.grazing_quality;
          camp.water_status = serverCondition.water_status;
          camp.fence_status = serverCondition.fence_status;
          camp.last_inspected_at = serverCondition.last_inspected_at;
          camp.last_inspected_by = serverCondition.last_inspected_by ?? undefined;
        }
      }
    }

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

  if (farmRes.ok) {
    const farm: { farmName: string; breed: string } = await farmRes.json();
    await seedFarmSettings({ farmName: farm.farmName, breed: farm.breed });
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

async function uploadAnimalCreate(animal: PendingAnimalCreate): Promise<boolean> {
  try {
    const settings = await getCachedFarmSettings();
    const breed = settings?.breed ?? 'Mixed';

    const res = await fetch('/api/animals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        animalId: animal.animal_id,
        name: animal.name ?? null,
        sex: animal.sex,
        category: animal.category,
        currentCamp: animal.current_camp,
        motherId: animal.mother_id ?? null,
        dateAdded: animal.date_added,
        breed,
        status: 'Active',
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function syncPendingAnimals(): Promise<{ synced: number; failed: number }> {
  const pending = await getPendingAnimalCreates();
  let synced = 0;
  let failed = 0;

  for (const animal of pending) {
    const ok = await uploadAnimalCreate(animal);
    if (ok) {
      await markAnimalCreateSynced(animal.local_id!);
      synced++;
    } else {
      await markAnimalCreateFailed(animal.local_id!);
      failed++;
    }
  }

  return { synced, failed };
}

export async function syncAndRefresh(): Promise<{ synced: number; failed: number }> {
  const [obsResult, animalsResult] = await Promise.all([
    syncPendingObservations(),
    syncPendingAnimals(),
  ]);
  await refreshCachedData(); // now server is up to date before we pull
  return {
    synced: obsResult.synced + animalsResult.synced,
    failed: obsResult.failed + animalsResult.failed,
  };
}
