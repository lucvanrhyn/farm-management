import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCachedFarmCreds,
  evictFarmCreds,
  __clearFarmCredsCache,
  __setFarmCredsEntryAge,
} from '@/lib/farm-creds-cache';
import type { FarmCreds } from '@/lib/meta-db';

const creds = (tursoUrl: string): FarmCreds => ({
  tursoUrl,
  tursoAuthToken: 'token-' + tursoUrl,
  tier: 'advanced',
});

describe('farm-creds-cache', () => {
  beforeEach(() => {
    __clearFarmCredsCache();
  });

  it('hits loader on first access, cache on second', async () => {
    const loader = vi.fn(async (slug: string) => creds(slug));

    const first = await getCachedFarmCreds('trio-b', loader);
    const second = await getCachedFarmCreds('trio-b', loader);

    expect(first).toEqual(creds('trio-b'));
    expect(second).toEqual(creds('trio-b'));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('isolates entries by slug', async () => {
    const loader = vi.fn(async (slug: string) => creds(slug));

    const a = await getCachedFarmCreds('trio-b', loader);
    const b = await getCachedFarmCreds('basson', loader);

    expect(a!.tursoUrl).toBe('trio-b');
    expect(b!.tursoUrl).toBe('basson');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('returns null and does not cache when loader returns null', async () => {
    const loader = vi.fn(async () => null);

    const first = await getCachedFarmCreds('nope', loader);
    const second = await getCachedFarmCreds('nope', loader);

    expect(first).toBeNull();
    expect(second).toBeNull();
    // null result = loader must run every time (no poisoning)
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('reloads after TTL expires', async () => {
    const loader = vi.fn(async (slug: string) => creds(slug));

    await getCachedFarmCreds('trio-b', loader);
    // Push the entry past the 10-min TTL boundary.
    __setFarmCredsEntryAge('trio-b', 11 * 60 * 1000);
    await getCachedFarmCreds('trio-b', loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('evictFarmCreds forces a reload on next access', async () => {
    const loader = vi.fn(async (slug: string) => creds(slug));

    await getCachedFarmCreds('trio-b', loader);
    evictFarmCreds('trio-b');
    await getCachedFarmCreds('trio-b', loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('evictFarmCreds for one slug does not disturb others', async () => {
    const loader = vi.fn(async (slug: string) => creds(slug));

    await getCachedFarmCreds('trio-b', loader);
    await getCachedFarmCreds('basson', loader);
    evictFarmCreds('trio-b');
    await getCachedFarmCreds('trio-b', loader);
    await getCachedFarmCreds('basson', loader);

    // trio-b: loaded twice (before + after evict); basson: once.
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('refreshes cachedAt on reload (TTL starts over)', async () => {
    const loader = vi.fn(async (slug: string) => creds(slug));

    await getCachedFarmCreds('trio-b', loader);
    __setFarmCredsEntryAge('trio-b', 11 * 60 * 1000); // expire
    await getCachedFarmCreds('trio-b', loader); // reload
    // After reload, entry age is 0. Hit cache on the very next call.
    await getCachedFarmCreds('trio-b', loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });
});
