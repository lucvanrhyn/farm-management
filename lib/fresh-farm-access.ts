import { getFarmsForUser, type UserFarm } from "@/lib/meta-db";

/**
 * Fresh per-(user, slug) authorisation re-check at the Node-runtime tenant
 * chokepoint.
 *
 * Why this exists
 * ───────────────
 * proxy.ts authenticates from the JWT and stamps the signed identity tuple
 * from the 8h `token.farms` snapshot (`lib/auth-options.ts` session.maxAge =
 * 60*60*8). The snapshot is only refreshed at sign-in or on an explicit
 * `useSession().update()`. That means up to 8h of stale trust:
 *
 *   • H3 — a user removed from a farm keeps access for up to 8h.
 *   • H4 — a lapsed subscription is not re-detected for up to 8h.
 *   • auth-M3 — a demoted ADMIN keeps the ADMIN role for up to 8h.
 *
 * The re-check CANNOT live in proxy.ts: that file runs on the Edge-compatible
 * middleware runtime and deliberately keeps a flat module graph (no Prisma /
 * meta-db imports). So this DB-backed re-check lives at the Node-runtime
 * handler chokepoint instead (`getFarmContext` / `getPrismaForSlugWithAuth`).
 *
 * Cache
 * ─────
 * A short-TTL in-memory cache (mirrors `lib/farm-creds-cache.ts`: a globalThis
 * Map keyed by userId, surviving Next.js hot-reload). The cache stores the
 * user's FULL farms list so that one entry serves every slug the user can
 * reach. With a 60s TTL the hot path pays at most one meta-db round-trip per
 * user per minute, and revocation (membership / role / subscription) propagates
 * within the TTL instead of the 8h JWT window.
 *
 * Fail-closed: on a meta-db error the helper returns `null` (deny) and does
 * NOT cache the failure — the next call retries. Granting on error would be
 * catastrophic (same posture as `requirePlatformAdmin` in `lib/auth.ts`).
 */

export const FRESH_FARM_ACCESS_TTL_MS = 60 * 1000;

type Entry = { farms: UserFarm[]; cachedAt: number };

const globalForCache = globalThis as unknown as {
  freshFarmAccessCache?: Map<string, Entry>;
};
if (!globalForCache.freshFarmAccessCache) {
  globalForCache.freshFarmAccessCache = new Map();
}
const cache = globalForCache.freshFarmAccessCache;

async function getCachedFarms(userId: string): Promise<UserFarm[]> {
  const existing = cache.get(userId);
  if (existing && Date.now() - existing.cachedAt < FRESH_FARM_ACCESS_TTL_MS) {
    return existing.farms;
  }
  // On error this rejects — callers catch and fail closed without caching.
  const fresh = await getFarmsForUser(userId);
  cache.set(userId, { farms: fresh, cachedAt: Date.now() });
  return fresh;
}

/**
 * Re-verify that `userId` is currently a member of `slug`, returning the FRESH
 * farm record (role + tier + subscriptionStatus) or `null` if access has been
 * revoked. Membership is read from meta-db behind the short-TTL cache.
 *
 * The caller decides what a returned record means:
 *   • `null`                       → removed member → 403 / redirect (H3).
 *   • `role`                       → fresh role for ADMIN re-checks (auth-M3).
 *   • `subscriptionStatus`         → fresh status for billing gates (H4).
 */
export async function verifyFreshFarmAccess(
  userId: string,
  slug: string,
): Promise<UserFarm | null> {
  if (!userId || !slug) return null;
  let farms: UserFarm[];
  try {
    farms = await getCachedFarms(userId);
  } catch {
    // Meta-db unreachable or threw — fail closed. Do not cache the failure.
    return null;
  }
  return farms.find((f) => f.slug === slug) ?? null;
}

/** Evict a user's cached membership (e.g. immediately after a role change). */
export function evictFreshFarmAccess(userId: string): void {
  cache.delete(userId);
}

// Test-only hook. Never call from app code.
export function __clearFreshFarmAccessCache(): void {
  cache.clear();
}

// Test-only hook for TTL simulation (mirrors farm-creds-cache).
export function __setFreshFarmAccessEntryAge(userId: string, ageMs: number): void {
  const entry = cache.get(userId);
  if (entry) entry.cachedAt = Date.now() - ageMs;
}
