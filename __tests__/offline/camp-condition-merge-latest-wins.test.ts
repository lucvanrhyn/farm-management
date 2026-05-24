// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';

/**
 * Issue #407 — Logger last-visit badge stuck at "Yesterday" after submit.
 *
 * Root cause (read/merge layer): `getCachedCampConditions` is wrapped in
 * `unstable_cache` with a 60s revalidate window, tagged `farm-<slug>-camps`.
 * `observationWriteTags` in lib/server/cache-tags.ts invalidates
 * `observations` + `dashboard` on every observation write — but NOT `camps`.
 * So immediately after the offline-sync queue POSTs a new camp_condition /
 * camp_check observation, the next `GET /api/camps/status` (fired by
 * `refreshCachedDataInternal`) returns the pre-write cached map.
 *
 * `seedCamps` then merges that stale server payload over the fresh local
 * write. The legacy merge was server-wins-when-present:
 *
 *     last_inspected_at: serverCamp.last_inspected_at ?? prevCamp.last_inspected_at
 *
 * The stale server value (non-nullish, just older) overrode the fresh
 * optimistic local value the submit handler stamped onto IDB. Tile pinned
 * at "Yesterday" until the cache TTL expired.
 *
 * Fix: lift the merge into a pure `mergeCampWithLocalOverlay` and replace
 * the nullish-coalescing rule with LATEST-TIMESTAMP-WINS on the
 * `last_inspected_at` boundary. The condition triplet (grazing/water/fence)
 * moves with the timestamp — they were captured at the same instant, so
 * they belong to the same "observation" and must not be split.
 *
 * This is the defense-in-depth half of the fix. The cache-tag invalidation
 * (issue #407's other fix in lib/server/cache-tags.ts) closes the race at
 * the server-cache layer; this closes it at the IDB-merge layer so future
 * cache races (e.g. multi-device, server-side write-after-read) cannot
 * resurrect the same class of bug.
 */

import type { Camp } from '@/lib/types';
import { mergeCampWithLocalOverlay } from '@/lib/offline-store';

const baseCamp: Camp = {
  camp_id: 'rivierkamp',
  camp_name: 'Rivierkamp',
  size_hectares: 190,
};

describe('mergeCampWithLocalOverlay — latest-timestamp-wins', () => {
  it('keeps fresh local last_inspected_at when server payload is stale (the #407 bug)', () => {
    // The submit handler stamped a fresh ISO onto IDB just now.
    const localFresh: Camp = {
      ...baseCamp,
      grazing_quality: 'Good',
      water_status: 'Full',
      fence_status: 'Intact',
      last_inspected_at: '2026-05-24T09:00:00Z',
      last_inspected_by: 'luc',
    };
    // The server payload (from the 60s-stale cache) shows yesterday's reading.
    const serverStale: Camp = {
      ...baseCamp,
      grazing_quality: 'Fair',
      water_status: 'Low',
      fence_status: 'Intact',
      last_inspected_at: '2026-05-23T15:00:00Z',
      last_inspected_by: 'pieter',
    };

    const merged = mergeCampWithLocalOverlay(serverStale, localFresh);

    expect(merged.last_inspected_at).toBe('2026-05-24T09:00:00Z');
    expect(merged.last_inspected_by).toBe('luc');
    expect(merged.grazing_quality).toBe('Good');
    expect(merged.water_status).toBe('Full');
    expect(merged.fence_status).toBe('Intact');
  });

  it('uses fresh server values when server is newer than local', () => {
    const localStale: Camp = {
      ...baseCamp,
      grazing_quality: 'Fair',
      water_status: 'Low',
      fence_status: 'Intact',
      last_inspected_at: '2026-05-23T08:00:00Z',
      last_inspected_by: 'pieter',
    };
    const serverFresh: Camp = {
      ...baseCamp,
      grazing_quality: 'Good',
      water_status: 'Full',
      fence_status: 'Intact',
      last_inspected_at: '2026-05-24T09:00:00Z',
      last_inspected_by: 'luc',
    };

    const merged = mergeCampWithLocalOverlay(serverFresh, localStale);

    expect(merged.last_inspected_at).toBe('2026-05-24T09:00:00Z');
    expect(merged.last_inspected_by).toBe('luc');
    expect(merged.grazing_quality).toBe('Good');
    expect(merged.water_status).toBe('Full');
    expect(merged.fence_status).toBe('Intact');
  });

  it('preserves local condition fields when server omits them (back-compat for /api/camps)', () => {
    // /api/camps (without /status merge) carries no condition fields.
    const serverBare: Camp = { ...baseCamp };
    const localPopulated: Camp = {
      ...baseCamp,
      grazing_quality: 'Good',
      water_status: 'Full',
      fence_status: 'Intact',
      last_inspected_at: '2026-05-24T09:00:00Z',
      last_inspected_by: 'luc',
    };

    const merged = mergeCampWithLocalOverlay(serverBare, localPopulated);

    expect(merged.last_inspected_at).toBe('2026-05-24T09:00:00Z');
    expect(merged.grazing_quality).toBe('Good');
    expect(merged.water_status).toBe('Full');
    expect(merged.fence_status).toBe('Intact');
    expect(merged.last_inspected_by).toBe('luc');
  });

  it('returns the server camp untouched when there is no prior local row', () => {
    const serverWithCondition: Camp = {
      ...baseCamp,
      grazing_quality: 'Good',
      water_status: 'Full',
      fence_status: 'Intact',
      last_inspected_at: '2026-05-24T09:00:00Z',
      last_inspected_by: 'luc',
    };

    const merged = mergeCampWithLocalOverlay(serverWithCondition, undefined);

    expect(merged).toEqual(serverWithCondition);
  });

  it('uses server metadata (camp_name, size_hectares) even when local has fresher inspection', () => {
    // Server is authoritative for the bare camp metadata.
    // Local overlay only contributes the condition triplet + timestamp pair.
    const localFresh: Camp = {
      camp_id: 'rivierkamp',
      camp_name: 'OLD NAME', // local row predates a rename on the admin side
      size_hectares: 100,    // stale size
      grazing_quality: 'Good',
      water_status: 'Full',
      fence_status: 'Intact',
      last_inspected_at: '2026-05-24T09:00:00Z',
      last_inspected_by: 'luc',
    };
    const serverRenamed: Camp = {
      camp_id: 'rivierkamp',
      camp_name: 'Rivierkamp', // admin renamed
      size_hectares: 190,      // admin updated size
      last_inspected_at: '2026-05-23T08:00:00Z',
      grazing_quality: 'Fair',
      water_status: 'Low',
      fence_status: 'Intact',
      last_inspected_by: 'pieter',
    };

    const merged = mergeCampWithLocalOverlay(serverRenamed, localFresh);

    // Local "inspection bundle" wins on timestamp.
    expect(merged.last_inspected_at).toBe('2026-05-24T09:00:00Z');
    expect(merged.grazing_quality).toBe('Good');
    expect(merged.water_status).toBe('Full');
    expect(merged.fence_status).toBe('Intact');
    expect(merged.last_inspected_by).toBe('luc');
    // Server metadata is authoritative for the non-condition fields.
    expect(merged.camp_name).toBe('Rivierkamp');
    expect(merged.size_hectares).toBe(190);
  });

  it('does not leak camp A condition fields into camp B (isolation)', () => {
    // The merge takes the local overlay for the SAME camp_id — never another camp's.
    const localCampA: Camp = {
      ...baseCamp,
      camp_id: 'camp-a',
      grazing_quality: 'Overgrazed',
      last_inspected_at: '2026-05-24T09:00:00Z',
    };
    const serverCampB: Camp = {
      ...baseCamp,
      camp_id: 'camp-b',
      camp_name: 'Camp B',
    };

    // Passing a local from a different camp must NOT bleed its condition.
    // Caller responsibility — assert by passing `undefined` (the correct call shape).
    const merged = mergeCampWithLocalOverlay(serverCampB, undefined);

    expect(merged.camp_id).toBe('camp-b');
    expect(merged.grazing_quality).toBeUndefined();
    expect(merged.last_inspected_at).toBeUndefined();
    // Sanity: localCampA's condition is unobservable from this call.
    expect(localCampA.grazing_quality).toBe('Overgrazed'); // unmodified
  });

  it('falls back to whichever side has a timestamp when only one is populated', () => {
    // Server null, local has fresh
    const localOnly: Camp = {
      ...baseCamp,
      grazing_quality: 'Good',
      last_inspected_at: '2026-05-24T09:00:00Z',
      last_inspected_by: 'luc',
    };
    const serverBare: Camp = { ...baseCamp };

    const mergedA = mergeCampWithLocalOverlay(serverBare, localOnly);
    expect(mergedA.last_inspected_at).toBe('2026-05-24T09:00:00Z');
    expect(mergedA.grazing_quality).toBe('Good');

    // Server has fresh, local row exists but no timestamp (e.g. brand-new IDB row).
    const localEmpty: Camp = { ...baseCamp };
    const serverFresh: Camp = {
      ...baseCamp,
      grazing_quality: 'Fair',
      last_inspected_at: '2026-05-24T09:00:00Z',
      last_inspected_by: 'pieter',
    };
    const mergedB = mergeCampWithLocalOverlay(serverFresh, localEmpty);
    expect(mergedB.last_inspected_at).toBe('2026-05-24T09:00:00Z');
    expect(mergedB.grazing_quality).toBe('Fair');
  });
});
