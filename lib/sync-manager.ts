// lib/sync-manager.ts
//
// Browser-only IndexedDB sync manager. All `console.*` calls in this
// file are intentional: this module only runs in the client (the
// service worker / `OfflineProvider` invokes it), where the structured
// `@/lib/logger` has no useful sink. Vercel-side logging is irrelevant
// for a browser-tab failure.
import {
  seedCamps,
  seedAnimals,
  seedFarmSettings,
  getCachedFarmSettings,
  getPendingObservations,
  getPendingAnimalCreates,
  getPendingPhotos,
  markPhotoUploaded,
  getPendingCoverReadings,
  markCoverReadingPosted,
  clearPendingAnimalUpdate,
  getFailedAnimals,
  getFailedCoverReadings,
  PendingObservation,
  PendingAnimalCreate,
} from './offline-store';
import { markSucceeded, markFailed, recordSyncAttempt } from './sync/queue';

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

/**
 * Options for `refreshCachedData`.
 *
 * `species` scopes the /api/camps fetch to a single species so the returned
 * `animal_count` per camp reflects only that species' herd. When omitted,
 * the route returns cross-species counts (back-compat for callers that
 * pre-date the multi-species mode toggle). Wave D-U3 / Codex audit P2 U3.
 *
 * Note (PRD #194 wave 3, #197): `refreshCachedData` is a pure cache pull.
 * It does NOT tick any sync-truth field. Only `syncAndRefresh` records
 * cycle outcomes — via `recordSyncAttempt` from the sync queue facade —
 * because that is the only path that distinguishes a full-success cycle
 * from a partial-failure one. This makes the caller-must-remember bug from
 * Codex C1/C3 structurally impossible: a cache pull cannot tick "synced".
 */
interface RefreshCachedDataOptions {
  species?: string;
}

/**
 * Pull the latest camps / animals / farm-settings snapshot from the server
 * into IndexedDB. Pure cache pull — no per-row sync, no failure paths
 * surfaced upward (a failed GET silently leaves the previous IDB row in
 * place; `seedAnimals` early-returns on empty payloads so a transient
 * fetch failure can never wipe a live herd).
 *
 * Truth-tick: none. The displayed "Synced: …" timestamp is owned by the
 * coordinator (`syncAndRefresh` → `recordSyncAttempt`). Cache pulls are
 * not sync cycles and must not advance the truth surface.
 */
export async function refreshCachedData(
  options: RefreshCachedDataOptions = {},
): Promise<void> {
  await refreshCachedDataInternal(options.species);
}

/**
 * Internal: cache pull. Same shape as the public entry point; kept as a
 * separate name so `syncAndRefresh` can call the cache pull without going
 * through the public entry point that may grow additional side effects in
 * future waves.
 */
async function refreshCachedDataInternal(species?: string): Promise<void> {
  const campsUrl = species
    ? `/api/camps?species=${encodeURIComponent(species)}`
    : '/api/camps';
  const [campsRes, animals, farmRes, statusRes] = await Promise.all([
    fetch(campsUrl),
    fetchAllAnimalsPaged(),
    fetch('/api/farm'),
    fetch('/api/camps/status'),
  ]);

  if (campsRes.ok) {
    const camps: Camp[] = await campsRes.json();

    // Merge server-authoritative condition data so camp colors survive a sync
    // cycle. /api/camps/status returns the latest camp_condition observation
    // per camp.
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
}

/**
 * Issue #208 — cap persisted error bodies to keep IDB rows sane. The
 * server can return arbitrarily large HTML/JSON on a 5xx, and we don't
 * want the dead-letter UI carrying multi-MB rows around.
 */
const MAX_ERROR_BODY_CHARS = 500;

function truncateError(body: string): string {
  return body.length > MAX_ERROR_BODY_CHARS ? body.slice(0, MAX_ERROR_BODY_CHARS) : body;
}

/**
 * Issue #208 — upload result envelope. The legacy contract was "string or
 * null" which dropped the failure cause on the floor. Returning the
 * structured envelope lets `syncPendingObservations` forward the cause
 * (HTTP status + truncated body, OR thrown-error message) to
 * `markObservationFailed` so the #209 dead-letter UI has something
 * actionable to show.
 */
type UploadResult<T> =
  | { ok: true; value: T }
  | { ok: false; statusCode: number | null; error: string };

async function uploadObservation(obs: PendingObservation): Promise<UploadResult<string>> {
  try {
    // Issue #206 — explicit POST body. Previously this stringified the whole
    // `obs` row, which coincidentally forwarded `clientLocalId` once the
    // field was added to `PendingObservation`. Naming the fields makes the
    // idempotency contract load-bearing: a future refactor that drops one
    // field by accident will now fail the Cycle 3 replay test instead of
    // silently regressing back to duplicate-row land.
    const body = {
      type: obs.type,
      camp_id: obs.camp_id,
      animal_id: obs.animal_id ?? null,
      details: obs.details,
      created_at: obs.created_at,
      clientLocalId: obs.clientLocalId ?? null,
    };
    const res = await fetch('/api/observations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Offline-first: caller marks the observation as failed and retries
      // later. We still log so operators can diagnose why syncing stalls.
      // Issue #208 — capture status + truncated body so the dead-letter UI
      // can render "stuck because …".
      const text = await res.text().catch(() => '');
      console.warn('[sync] observation upload failed:', res.status, res.statusText);
      return {
        ok: false,
        statusCode: res.status,
        error: truncateError(text || res.statusText),
      };
    }
    const data = await res.json().catch((parseErr) => {
      console.warn('[sync] observation response was not JSON:', parseErr);
      return {};
    });
    const serverId = (data.id as string) ?? null;
    if (!serverId) {
      // Defensive: 2xx with no `id` field is a contract violation; surface
      // it as a structured failure so the row enters the dead-letter UI
      // instead of vanishing.
      return {
        ok: false,
        statusCode: res.status,
        error: 'server returned 2xx with no id field',
      };
    }
    return { ok: true, value: serverId };
  } catch (err) {
    console.warn('[sync] observation upload threw:', err);
    return {
      ok: false,
      statusCode: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function syncPendingObservations(): Promise<{
  synced: number;
  failed: number;
  localToServerId: Map<number, string>;
}> {
  // Issue #208 — `getPendingObservations` no longer returns failed rows.
  // Failed rows stay sticky in their own bucket until the #209 retry-from-UI
  // explicitly flips them back. This is the structural fix for the
  // perpetual-"N pending"-pill bug.
  const pending = await getPendingObservations();
  let synced = 0;
  let failed = 0;
  const localToServerId = new Map<number, string>();

  for (const obs of pending) {
    const result = await uploadObservation(obs);
    if (result.ok) {
      await markSucceeded('observation', obs.local_id!, { id: result.value });
      localToServerId.set(obs.local_id!, result.value);
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
      await markFailed('observation', obs.local_id!, 'upload_failed', {
        statusCode: result.statusCode,
        error: result.error,
      });
      failed++;
    }
  }

  return { synced, failed, localToServerId };
}

async function uploadAnimalCreate(
  animal: PendingAnimalCreate,
): Promise<UploadResult<true>> {
  try {
    const settings = await getCachedFarmSettings();
    const breed = settings?.breed ?? 'Mixed';

    const res = await fetch('/api/animals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Issue #207 — explicit POST body. Mirrors the same load-bearing
      // discipline applied to `uploadObservation` under #206 / PR #214:
      // naming each field makes the idempotency contract structural — a
      // future refactor that drops `clientLocalId` by accident will fail
      // the Cycle 3 replay test instead of silently regressing back to
      // duplicate-row land.
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
        clientLocalId: animal.clientLocalId ?? null,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[sync] animal create upload failed:', res.status, res.statusText);
      return {
        ok: false,
        statusCode: res.status,
        error: truncateError(text || res.statusText),
      };
    }
    return { ok: true, value: true };
  } catch (err) {
    console.warn('[sync] animal create upload threw:', err);
    return {
      ok: false,
      statusCode: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function syncPendingAnimals(): Promise<{ synced: number; failed: number }> {
  // Issue #208 — pending list is now strict pending (no auto-retry of failed).
  const pending = await getPendingAnimalCreates();
  let synced = 0;
  let failed = 0;

  for (const animal of pending) {
    const result = await uploadAnimalCreate(animal);
    if (result.ok) {
      await markSucceeded('animal', animal.local_id!);
      synced++;
    } else {
      await markFailed('animal', animal.local_id!, 'upload_failed', {
        statusCode: result.statusCode,
        error: result.error,
      });
      failed++;
    }
  }

  return { synced, failed };
}

async function syncPendingPhotos(
  localToServerId: Map<number, string>,
): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;
  const pendingPhotos = await getPendingPhotos();
  for (const photo of pendingPhotos) {
    try {
      // Legacy rows from before the type narrowing may have a string id.
      // They are unrecoverable (the server already created the observation
      // without an attachment URL), so mark failed and move on.
      if (typeof photo.observation_local_id !== 'number') {
        await markFailed('photo', photo.local_id!, 'legacy_string_id');
        failed++;
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
        await markFailed('photo', photo.local_id!, `patch_failed_${patchRes.status}`);
        failed++;
        continue;
      }

      await markSucceeded('photo', photo.local_id!);
      synced++;
    } catch (e) {
      console.error('Photo sync failed', e);
      await markFailed('photo', photo.local_id!, 'exception');
      failed++;
    }
  }
  return { synced, failed };
}

export async function syncPendingCoverReadings(): Promise<{ synced: number; failed: number }> {
  // Issue #208 — pending list is now strict pending (no auto-retry of failed).
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
            // Issue #207 — forward the queued `clientLocalId` so a retry
            // (network blip between successful POST and the local
            // `markCoverReadingPosted` write) collapses to one server row
            // via `CampCoverReading.clientLocalId` upsert.
            body: JSON.stringify({
              coverCategory: reading.cover_category,
              clientLocalId: reading.clientLocalId ?? null,
            }),
          },
        );
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          await markFailed(
            'cover-reading',
            reading.local_id!,
            `post_failed_${res.status}`,
            {
              statusCode: res.status,
              error: truncateError(text || res.statusText),
            },
          );
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
        if (!uploadRes.ok) {
          // Photo upload failed — DO NOT mark the reading synced (that would
          // silently drop the photo from the queue). Mark failed so the next
          // sync cycle retries; the reading row is already persisted server-side
          // via `markCoverReadingPosted`, so the retry only re-uploads the photo.
          console.error(
            `[sync] cover photo upload failed (status ${uploadRes.status}) for reading ${reading.local_id}`,
          );
          const text = await uploadRes.text().catch(() => '');
          await markFailed(
            'cover-reading',
            reading.local_id!,
            `photo_upload_failed_${uploadRes.status}`,
            {
              statusCode: uploadRes.status,
              error: truncateError(text || `photo upload failed ${uploadRes.statusText}`),
            },
          );
          failed++;
          continue;
        }
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
          const text = await patchRes.text().catch(() => '');
          await markFailed(
            'cover-reading',
            reading.local_id!,
            `photo_patch_failed_${patchRes.status}`,
            {
              statusCode: patchRes.status,
              error: truncateError(text || `photo attachment PATCH failed ${patchRes.statusText}`),
            },
          );
          failed++;
          continue;
        }
      }

      await markSucceeded('cover-reading', reading.local_id!);
      synced++;
    } catch (e) {
      console.error('[sync] cover reading failed:', e);
      await markFailed('cover-reading', reading.local_id!, 'exception', {
        statusCode: null,
        error: e instanceof Error ? e.message : String(e),
      });
      failed++;
    }
  }

  return { synced, failed };
}

interface SyncAndRefreshOptions {
  /** Forwarded to `refreshCachedData` so the post-sync cache pull is mode-scoped. */
  species?: string;
}

/**
 * Issue #252 — per-item descriptor surfaced to the UI so the OfflineProvider
 * can fire one toast per row that actually landed on the server. The 2026-05-13
 * stress test confirmed that aggregate-only feedback ("12 synced") let users
 * miss the BB-C014 case where the visible obs was actually a different one
 * that landed earlier. Per-item lets the UI render "Health obs for BB-C014
 * synced", which is the load-bearing trust signal the user needs.
 */
export interface SyncedItem {
  kind: 'observation' | 'animal' | 'cover-reading';
  /** Stable per-row identifier — `clientLocalId` when available, else the
   *  IDB `local_id` cast to string. The OfflineProvider de-dupes its toast
   *  buffer on this so a flaky network that retries the same row does not
   *  fire two toasts. */
  itemKey: string;
  /** Human-readable subject for the toast body, e.g.
   *  `"Health observation for BB-C014"` or `"New animal KALF-123"`. */
  label: string;
}

function describePendingObservation(o: PendingObservation): string {
  const typeLabel =
    o.type === 'health_issue'
      ? 'Health observation'
      : o.type === 'weighing'
        ? 'Weighing'
        : o.type === 'reproduction'
          ? 'Reproduction'
          : o.type === 'movement'
            ? 'Movement'
            : o.type === 'calving'
              ? 'Calving'
              : o.type === 'camp_condition'
                ? 'Camp condition'
                : o.type === 'treatment'
                  ? 'Treatment'
                  : o.type.replace(/_/g, ' ');
  if (o.animal_id) return `${typeLabel} for ${o.animal_id}`;
  return `${typeLabel} on camp ${o.camp_id}`;
}

export async function syncAndRefresh(
  options: SyncAndRefreshOptions = {},
): Promise<{ synced: number; failed: number; syncedItems: SyncedItem[] }> {
  const { species } = options;

  // Capture per-row snapshots BEFORE the sync attempts so we can describe
  // each row that successfully synced. After `markSucceeded` flips status
  // to `synced`, the row is no longer reachable through the pending getters.
  const obsBefore = await getPendingObservations();
  const animalsBefore = await getPendingAnimalCreates();
  const coversBefore = await getPendingCoverReadings();

  const [obsResult, animalsResult, coversResult] = await Promise.all([
    syncPendingObservations(),
    syncPendingAnimals(),
    syncPendingCoverReadings(),
  ]);
  const photoResult = await syncPendingPhotos(obsResult.localToServerId);

  // Build the per-item event list. A row is a "synced item" iff
  // (a) it was in the pending snapshot AND (b) the corresponding sync helper
  // returned success for it. For observations we use `localToServerId` as the
  // truth source; for animals/cover we re-read failed-bucket membership and
  // exclude any row still failed.
  const syncedItems: SyncedItem[] = [];
  for (const o of obsBefore) {
    if (o.local_id !== undefined && obsResult.localToServerId.has(o.local_id)) {
      syncedItems.push({
        kind: 'observation',
        itemKey: o.clientLocalId ?? `obs-${o.local_id}`,
        label: describePendingObservation(o),
      });
    }
  }
  // Animals + cover readings: a row that succeeded is gone from BOTH
  // `getFailedAnimals()` and `getPendingAnimalCreates()`. Use the post-sync
  // failed-bucket as the negative signal — anything in the snapshot that is
  // NOT still failed and NOT still pending must have transitioned to synced.
  if (animalsResult.synced > 0) {
    const stillFailed = new Set(
      (await getFailedAnimals()).map((a) => a.local_id),
    );
    const stillPending = new Set(
      (await getPendingAnimalCreates()).map((a) => a.local_id),
    );
    for (const a of animalsBefore) {
      if (
        a.local_id !== undefined &&
        !stillFailed.has(a.local_id) &&
        !stillPending.has(a.local_id)
      ) {
        syncedItems.push({
          kind: 'animal',
          itemKey: a.clientLocalId ?? `animal-${a.local_id}`,
          label: a.name ? `New animal ${a.animal_id} (${a.name})` : `New animal ${a.animal_id}`,
        });
      }
    }
  }
  if (coversResult.synced > 0) {
    const stillFailed = new Set(
      (await getFailedCoverReadings()).map((c) => c.local_id),
    );
    const stillPending = new Set(
      (await getPendingCoverReadings()).map((c) => c.local_id),
    );
    for (const c of coversBefore) {
      if (
        c.local_id !== undefined &&
        !stillFailed.has(c.local_id) &&
        !stillPending.has(c.local_id)
      ) {
        syncedItems.push({
          kind: 'cover-reading',
          itemKey: c.clientLocalId ?? `cover-${c.local_id}`,
          label: `Cover reading on camp ${c.camp_id}`,
        });
      }
    }
  }

  const synced =
    obsResult.synced + animalsResult.synced + coversResult.synced + photoResult.synced;
  const failed =
    obsResult.failed + animalsResult.failed + coversResult.failed + photoResult.failed;

  // Cache pull. Does not tick truth — `recordSyncAttempt` below is the
  // single place a cycle outcome can move `lastFullSuccessAt`.
  await refreshCachedDataInternal(species);

  // Canonical truth: every cycle records an attempt; lastFullSuccessAt
  // moves only when every kind reported zero failures. This is the
  // structural fix for the caller-must-remember bug from Codex C1/C3.
  const cycleTimestamp = new Date().toISOString();
  await recordSyncAttempt({
    timestamp: cycleTimestamp,
    perKindResults: {
      observation: obsResult,
      animal: animalsResult,
      'cover-reading': coversResult,
      photo: photoResult,
    },
  });

  return { synced, failed, syncedItems };
}
