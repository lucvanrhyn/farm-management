import { CAMPS, ANIMALS } from './dummy-data';
import {
  seedCamps,
  seedAnimals,
  getPendingObservations,
  markObservationSynced,
  markObservationFailed,
  setLastSyncedAt,
  PendingObservation,
} from './offline-store';

export async function refreshCachedData(): Promise<void> {
  await seedCamps(CAMPS);
  await seedAnimals(ANIMALS);
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
