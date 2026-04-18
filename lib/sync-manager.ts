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
  getPendingPhotos,
  markPhotoSynced,
  setLastSyncedAt,
  clearPendingAnimalUpdate,
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
    let mergedCamps = camps;
    if (statusRes.ok) {
      const statusMap: Record<string, ServerCampCondition> = await statusRes.json();
      mergedCamps = camps.map((camp) => {
        const serverCondition = statusMap[camp.camp_id];
        if (!serverCondition) return camp;
        return {
          ...camp,
          grazing_quality: serverCondition.grazing_quality,
          water_status: serverCondition.water_status,
          fence_status: serverCondition.fence_status,
          last_inspected_at: serverCondition.last_inspected_at,
          last_inspected_by: serverCondition.last_inspected_by ?? undefined,
        };
      });
    }

    await seedCamps(mergedCamps);
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

async function uploadObservation(obs: PendingObservation): Promise<string | null> {
  try {
    const res = await fetch('/api/observations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obs),
    });
    if (!res.ok) {
      // Offline-first: caller marks the observation as failed and retries
      // later. We still log so operators can diagnose why syncing stalls.
      console.warn('[sync] observation upload failed:', res.status, res.statusText);
      return null;
    }
    const data = await res.json().catch((parseErr) => {
      console.warn('[sync] observation response was not JSON:', parseErr);
      return {};
    });
    return (data.id as string) ?? null;
  } catch (err) {
    console.warn('[sync] observation upload threw:', err);
    return null;
  }
}

export async function syncPendingObservations(): Promise<{
  synced: number;
  failed: number;
  localToServerId: Map<number, string>;
}> {
  const pending = await getPendingObservations();
  let synced = 0;
  let failed = 0;
  const localToServerId = new Map<number, string>();

  for (const obs of pending) {
    const serverId = await uploadObservation(obs);
    if (serverId) {
      await markObservationSynced(obs.local_id!);
      localToServerId.set(obs.local_id!, serverId);
      synced++;
      // If this observation carried an animal-level mutation (camp_move,
      // status_change, etc.), the server has now applied it — drop the
      // animal from the pending_animal_updates marker set so the next
      // refresh is free to orphan-sweep it normally. Observations without
      // an animal_id (farm-wide events) don't touch the marker set.
      if (obs.animal_id) {
        await clearPendingAnimalUpdate(obs.animal_id);
      }
    } else {
      await markObservationFailed(obs.local_id!);
      failed++;
    }
  }

  return { synced, failed, localToServerId };
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
    if (!res.ok) {
      console.warn('[sync] animal create upload failed:', res.status, res.statusText);
    }
    return res.ok;
  } catch (err) {
    console.warn('[sync] animal create upload threw:', err);
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

async function syncPendingPhotos(localToServerId: Map<number, string>): Promise<void> {
  const pendingPhotos = await getPendingPhotos();
  for (const photo of pendingPhotos) {
    try {
      const formData = new FormData();
      formData.append('file', photo.blob, `photo-${photo.local_id}.jpg`);
      const res = await fetch('/api/photos/upload', { method: 'POST', body: formData });
      if (!res.ok) continue;

      const { url } = await res.json();

      // Resolve the server observation ID from the local_id map
      const observationLocalId = photo.observation_local_id;
      const serverId =
        typeof observationLocalId === 'number'
          ? localToServerId.get(observationLocalId)
          : undefined;

      if (serverId) {
        const patchRes = await fetch(`/api/observations/${serverId}/attachment`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attachmentUrl: url }),
        });
        // If the PATCH fails, don't mark as synced — retry on next sync cycle
        if (!patchRes.ok) continue;
      }

      await markPhotoSynced(photo.local_id!);
    } catch (e) {
      console.error('Photo sync failed', e);
    }
  }
}

export async function syncAndRefresh(): Promise<{ synced: number; failed: number }> {
  const [obsResult, animalsResult] = await Promise.all([
    syncPendingObservations(),
    syncPendingAnimals(),
  ]);
  await syncPendingPhotos(obsResult.localToServerId);
  await refreshCachedData(); // now server is up to date before we pull
  return {
    synced: obsResult.synced + animalsResult.synced,
    failed: obsResult.failed + animalsResult.failed,
  };
}
