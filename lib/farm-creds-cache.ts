import type { FarmCreds } from '@/lib/meta-db';

// Module-scoped cache for per-farm Turso credentials. Lives in Lambda
// instance memory — cold starts still pay the meta-DB lookup, warm
// invocations skip it. Intentionally NOT Redis/KV: per-Lambda is
// sufficient at current scale and avoids a network round-trip to the
// cache layer itself.
//
// Eviction happens from two places:
//   1. TTL expiry (this module).
//   2. Auth-failure retry path (farm-prisma.ts) — when a libSQL 401
//      fires, both the PrismaClient AND this creds entry are evicted
//      so the next attempt re-reads from meta-DB in case Turso rotated
//      the token.

const TTL_MS = 10 * 60 * 1000;

type Entry = { creds: FarmCreds; cachedAt: number };

const globalForCache = globalThis as unknown as {
  farmCredsCache?: Map<string, Entry>;
};
if (!globalForCache.farmCredsCache) {
  globalForCache.farmCredsCache = new Map();
}
const cache = globalForCache.farmCredsCache;

export async function getCachedFarmCreds(
  slug: string,
  loader: (slug: string) => Promise<FarmCreds | null>,
): Promise<FarmCreds | null> {
  const existing = cache.get(slug);
  if (existing && Date.now() - existing.cachedAt < TTL_MS) {
    return existing.creds;
  }
  const fresh = await loader(slug);
  if (fresh) cache.set(slug, { creds: fresh, cachedAt: Date.now() });
  else cache.delete(slug);
  return fresh;
}

export function evictFarmCreds(slug: string): void {
  cache.delete(slug);
}

// Test-only hook. Never call from app code.
export function __clearFarmCredsCache(): void {
  cache.clear();
}

// Test-only hook for TTL simulation.
export function __setFarmCredsEntryAge(slug: string, ageMs: number): void {
  const entry = cache.get(slug);
  if (entry) entry.cachedAt = Date.now() - ageMs;
}
