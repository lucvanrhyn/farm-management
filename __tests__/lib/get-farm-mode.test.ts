// @vitest-environment node
/**
 * S7 / sp-L1 (stress-test remediation 2026-06-01) — fresh-login farm mode
 * must derive from the farm's species settings, not a hardcoded "cattle".
 *
 * Root cause pinned here: `getFarmMode` fell back to the literal "cattle"
 * whenever the `farmtrack-mode-<slug>` cookie was absent (fresh login, new
 * device, cleared cookies). Server components and species-scoped API routes
 * (`/api/mobs`, camps pages, dashboard) therefore rendered cattle-scoped
 * data on sheep/game farms until the user manually toggled the mode.
 *
 * Contract pinned by this suite:
 *   1. A valid mode cookie always wins (no settings read on that path).
 *   2. With no cookie (or an invalid one), the default is the FIRST VALID
 *      species in the farm's enabled-species settings — the same source
 *      `FarmModeProvider` seeds `enabledModes` from, so server and client
 *      defaults move together by construction.
 *   3. When the settings read fails or yields nothing usable, fail open to
 *      "cattle" (mirrors the fail-open in app/[farmSlug]/layout.tsx).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookieValue: undefined as string | undefined,
  getCachedFarmSpeciesSettings: vi.fn(async () => ({ enabledSpecies: ['cattle'] })),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name.startsWith('farmtrack-mode-') && mocks.cookieValue !== undefined
        ? { name, value: mocks.cookieValue }
        : undefined,
  })),
}));

vi.mock('@/lib/server/cached', () => ({
  getCachedFarmSpeciesSettings: mocks.getCachedFarmSpeciesSettings,
}));

beforeEach(() => {
  mocks.cookieValue = undefined;
  mocks.getCachedFarmSpeciesSettings.mockReset();
  mocks.getCachedFarmSpeciesSettings.mockResolvedValue({ enabledSpecies: ['cattle'] });
});

describe('getFarmMode — cookie path', () => {
  it('returns the cookie mode when present and valid, without reading settings', async () => {
    mocks.cookieValue = 'sheep';
    const { getFarmMode } = await import('@/lib/server/get-farm-mode');

    await expect(getFarmMode('trio-b')).resolves.toBe('sheep');
    expect(mocks.getCachedFarmSpeciesSettings).not.toHaveBeenCalled();
  });

  it('ignores an invalid cookie value and falls through to the settings default', async () => {
    mocks.cookieValue = 'ostrich';
    mocks.getCachedFarmSpeciesSettings.mockResolvedValue({
      enabledSpecies: ['game', 'cattle'],
    });
    const { getFarmMode } = await import('@/lib/server/get-farm-mode');

    await expect(getFarmMode('trio-b')).resolves.toBe('game');
  });
});

describe('getFarmMode — fresh login (no cookie) derives from farm species settings', () => {
  it('returns the first valid enabled species instead of hardcoding cattle', async () => {
    mocks.getCachedFarmSpeciesSettings.mockResolvedValue({
      enabledSpecies: ['sheep', 'cattle'],
    });
    const { getFarmMode } = await import('@/lib/server/get-farm-mode');

    await expect(getFarmMode('sheep-farm')).resolves.toBe('sheep');
    expect(mocks.getCachedFarmSpeciesSettings).toHaveBeenCalledWith('sheep-farm');
  });

  it('skips unknown species ids in the settings list', async () => {
    mocks.getCachedFarmSpeciesSettings.mockResolvedValue({
      enabledSpecies: ['ostrich', 'game'],
    });
    const { getFarmMode } = await import('@/lib/server/get-farm-mode');

    await expect(getFarmMode('game-farm')).resolves.toBe('game');
  });

  it('fails open to cattle when the settings list has no valid species', async () => {
    mocks.getCachedFarmSpeciesSettings.mockResolvedValue({ enabledSpecies: [] });
    const { getFarmMode } = await import('@/lib/server/get-farm-mode');

    await expect(getFarmMode('legacy-farm')).resolves.toBe('cattle');
  });

  it('fails open to cattle when the settings read throws (tenant DB outage)', async () => {
    mocks.getCachedFarmSpeciesSettings.mockRejectedValue(new Error('turso down'));
    const { getFarmMode } = await import('@/lib/server/get-farm-mode');

    await expect(getFarmMode('any-farm')).resolves.toBe('cattle');
  });
});
