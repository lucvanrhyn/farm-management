// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Bug L2 — seedCamps must preserve locally-set condition fields.
 *
 * `/api/camps` returns bare camp metadata (camp_id, camp_name, size_hectares,
 * …) with no grazing/water/fence condition data. Before the fix, `seedCamps`
 * did a straight `put` which wiped those fields on every refresh, so any camp
 * condition edited via the logger would reset at the next sync.
 *
 * The fix reads the existing IDB row before overwriting and preserves any
 * condition field the server did not send.
 */

import 'fake-indexeddb/auto';

beforeEach(() => {
  vi.resetModules();
});

async function loadStore() {
  const mod = await import('@/lib/offline-store');
  // Unique DB name per test keeps each spec isolated without resetting the
  // IDB factory (which has no published type declarations).
  mod.setActiveFarmSlug(`test-${Math.random().toString(36).slice(2)}`);
  return mod;
}

describe('seedCamps condition-field preservation', () => {
  it('preserves grazing_quality / water_status / fence_status when server omits them', async () => {
    const { seedCamps, getCachedCamps } = await loadStore();

    // First pass: local row has full condition data (e.g. just-logged observation).
    await seedCamps([
      {
        camp_id: 'camp-1',
        camp_name: 'Rivier',
        size_hectares: 42,
        grazing_quality: 'good',
        water_status: 'full',
        fence_status: 'good',
        last_inspected_at: '2026-04-18T08:00:00Z',
        last_inspected_by: 'Dicky',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ]);

    // Second pass: server payload carries no condition fields (bare /api/camps).
    await seedCamps([
      {
        camp_id: 'camp-1',
        camp_name: 'Rivier',
        size_hectares: 42,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ]);

    const [stored] = await getCachedCamps();
    expect(stored.grazing_quality).toBe('good');
    expect(stored.water_status).toBe('full');
    expect(stored.fence_status).toBe('good');
    expect(stored.last_inspected_at).toBe('2026-04-18T08:00:00Z');
    expect(stored.last_inspected_by).toBe('Dicky');
    // Server fields still applied.
    expect(stored.camp_name).toBe('Rivier');
    expect(stored.size_hectares).toBe(42);
  });
});
