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
  markPhotoUploaded,
  markPhotoFailed,
  getPendingCoverReadings,
  markCoverReadingSynced,
  markCoverReadingFailed,
  markCoverReadingPosted,
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

// Pull /api/animals in fixed-size batches and upsert each batch into IDB
// as it arrives. Paired with the cursor pagination on the server side, this
// keeps peak memory bounded on large herds and lets the logger paint the
// first screenful of animals before the full list lands.
//
// P2 perf de-dupe (2026-04-23): raised from 500 → 1000 so that herds up to
// ~1000 animals (including Trio B's 874) fit in a single round trip instead
// of two sequential pages on every cold visit to /logger. Pagination remains
// the correct fallback for farms larger than a single page.
const ANIMALS_PAGE_SIZE = 1000;

interface AnimalsPage {
  items: PrismaAnimal[];
  nextCursor: string | null;
  hasMore: boolean;
}

function mapPrismaAnimal(a: PrismaAnimal): Animal {
  return {
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
  };
}

async function fetchAllAnimalsPaged(): Promise<Animal[] | null> {
  const collected: Animal[] = [];
  let cursor: string | null = null;
  // Defensive upper bound on loop iterations. At 1000 rows per page this
  // caps at 100k animals per sync — well beyond any realistic SA herd,
  // and guarantees we never spin forever if the server mis-reports
  // `hasMore`.
  const MAX_PAGES = 100;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ limit: String(ANIMALS_PAGE_SIZE) });
    if (cursor) params.set('cursor', cursor);
    const res = await fetch(`/api/animals?${params.toString()}`);
    if (!res.ok) {
      console.warn('[sync] animals page fetch failed:', res.status, res.statusText);
      return null;
    }
    const body = (await res.json()) as AnimalsPage;
    for (const a of body.items) collected.push(mapPrismaAnimal(a));
    if (!body.hasMore || !body.nextCursor) return collected;
    cursor = body.nextCursor;
  }
  console.warn('[sync] animals pagination hit MAX_PAGES cap');
  return collected;
}

export async function refreshCachedData(): Promise<void> {
  // Three top-level refreshes run in parallel; animals pagination happens
  // inside its own helper. /api/animals is no longer in the outer fan-out
  // because it may take multiple requests.
  const [campsRes, animals, farmRes, statusRes] = await Promise.all([
    fetch('/api/camps'),
    fetchAllAnimalsPaged(),
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

  if (animals !== null) {
    await seedAnimals(animals);
  }

  if (farmRes.ok) {
    const farm: { farmName: string; breed: string; heroImageUrl?: string } =
      await farmRes.json();
    await seedFarmSettings({
      farmName: farm.farmName,
      breed: farm.breed,
      heroImageUrl: farm.heroImageUrl,
    });
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
      // Legacy rows from before the type narrowing may have a string id.
      // They are unrecoverable (the server already created the observation
      // without an attachment URL), so mark failed and move on.
      if (typeof photo.observation_local_id !== 'number') {
        await markPhotoFailed(photo.local_id!);
        continue;
      }

      // If a previous sync cycle uploaded the blob but failed the PATCH,
      // blob_url is already set — skip the upload to avoid duplicate blobs.
      let blobUrl = photo.blob_url;
      if (!blobUrl) {
        const formData = new FormData();
        formData.append('file', photo.blob, `photo-${photo.local_id}.jpg`);
        const uploadRes = await fetch('/api/photos/upload', { method: 'POST', body: formData });
        if (!uploadRes.ok) continue; // leave pending, retry next cycle

        const uploadData = await uploadRes.json();
        blobUrl = uploadData.url as string;
        // Persist the URL so retries skip re-upload even if PATCH fails below.
        await markPhotoUploaded(photo.local_id!, blobUrl);
      }

      // Resolve the server observation ID. If the corresponding observation
      // sync failed this cycle, serverId will be missing — leave the photo
      // as pending so it retries alongside the observation on the next cycle.
      const serverId = localToServerId.get(photo.observation_local_id);
      if (!serverId) continue;

      const patchRes = await fetch(`/api/observations/${serverId}/attachment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attachmentUrl: blobUrl }),
      });

      if (!patchRes.ok) {
        // PATCH failed — mark as failed so it retries, but blob_url is
        // already persisted so the next retry skips the upload step.
        await markPhotoFailed(photo.local_id!);
        continue;
      }

      await markPhotoSynced(photo.local_id!);
    } catch (e) {
      console.error('Photo sync failed', e);
      await markPhotoFailed(photo.local_id!);
    }
  }
}

export async function syncPendingCoverReadings(): Promise<{ synced: number; failed: number }> {
  const pending = await getPendingCoverReadings();
  let synced = 0;
  let failed = 0;

  for (const reading of pending) {
    try {
      // If a previous cycle posted the reading but failed the photo PATCH,
      // server_reading_id is already set — skip re-creating the reading row.
      let serverId = reading.server_reading_id;
      if (!serverId) {
        const res = await fetch(
          `/api/${reading.farm_slug}/camps/${reading.camp_id}/cover`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ coverCategory: reading.cover_category }),
          },
        );
        if (!res.ok) {
          await markCoverReadingFailed(reading.local_id!);
          failed++;
          continue;
        }
        const data = await res.json();
        serverId = (data.reading?.id ?? data.id) as string;
        // Persist so a subsequent photo-PATCH retry doesn't duplicate the row.
        await markCoverReadingPosted(reading.local_id!, serverId);
      }

      // Upload photo if one was captured with this reading.
      if (reading.photo_blob) {
        const formData = new FormData();
        formData.append('file', reading.photo_blob, `cover-${reading.local_id}.jpg`);
        const uploadRes = await fetch('/api/photos/upload', { method: 'POST', body: formData });
        if (uploadRes.ok) {
          const { url } = await uploadRes.json();
          const patchRes = await fetch(
            `/api/${reading.farm_slug}/camps/${reading.camp_id}/cover/${serverId}/attachment`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ attachmentUrl: url }),
            },
          );
          if (!patchRes.ok) {
            // Leave as failed — reading row exists, next cycle retries photo only.
            await markCoverReadingFailed(reading.local_id!);
            failed++;
            continue;
          }
        }
      }

      await markCoverReadingSynced(reading.local_id!);
      synced++;
    } catch (e) {
      console.error('[sync] cover reading failed:', e);
      await markCoverReadingFailed(reading.local_id!);
      failed++;
    }
  }

  return { synced, failed };
}

export async function syncAndRefresh(): Promise<{ synced: number; failed: number }> {
  const [obsResult, animalsResult, coversResult] = await Promise.all([
    syncPendingObservations(),
    syncPendingAnimals(),
    syncPendingCoverReadings(),
  ]);
  await syncPendingPhotos(obsResult.localToServerId);
  await refreshCachedData(); // now server is up to date before we pull
  return {
    synced: obsResult.synced + animalsResult.synced + coversResult.synced,
    failed: obsResult.failed + animalsResult.failed + coversResult.failed,
  };
}
