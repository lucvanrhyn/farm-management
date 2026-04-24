/**
 * Phase G (P6.5) — URL-slug-validated farm context resolver.
 *
 * Why this exists
 * ---------------
 * `getFarmContext()` trusts the slug that `proxy.ts` stamped onto the
 * request. Proxy derives that slug from either (a) the farm-page URL regex
 * `[farmSlug]/(admin|dashboard|logger|home|tools|sheep|game)` or (b) the
 * `active_farm_slug` cookie. Crucially, the regex does NOT match API paths
 * like `/api/[farmSlug]/...`, so for those routes the signed slug comes
 * from the cookie — which may disagree with the URL slug (user has cookie
 * set to farm A but hits `/api/farm-B/...`).
 *
 * We deliberately do NOT widen `proxy.ts`'s regex to cover API routes:
 * that regex is shared with the page-route fast-path and changing it risks
 * regressions there. Instead this helper validates the signed slug at the
 * handler boundary.
 *
 * Contract
 * --------
 * - Fast path: proxy-signed slug == caller-supplied `slug` → return the
 *   fast-path context (0 meta-db hits, 0 getServerSession calls).
 * - Mismatch or no-signed-headers: fall back to the legacy
 *   `getServerSession` + `getPrismaForSlugWithAuth(session, slug)` pair,
 *   which already performs the cross-farm authorisation check.
 * - On auth failure → `null` (callers return 401).
 */

import { getServerSession } from 'next-auth';
import type { Session } from 'next-auth';
import type { NextRequest } from 'next/server';

import { authOptions } from '@/lib/auth-options';
import { getPrismaForSlugWithAuth } from '@/lib/farm-prisma';

import { getFarmContext, type FarmContext } from './farm-context';

// Per-(request, slug) memoisation. Handlers may call this helper multiple
// times within one request (the handler body + a helper); we avoid redoing
// the fast-path verification or the legacy-fallback auth on each call. The
// WeakMap is keyed by NextRequest so entries are collected with the request.
const requestCache = new WeakMap<NextRequest, Map<string, Promise<FarmContext | null>>>();

export async function getFarmContextForSlug(
  slug: string,
  req?: NextRequest,
): Promise<FarmContext | null> {
  if (req) {
    const bySlug = requestCache.get(req);
    if (bySlug) {
      const cached = bySlug.get(slug);
      if (cached) return cached;
    }
    const promise = resolve(slug, req);
    const entry = bySlug ?? new Map<string, Promise<FarmContext | null>>();
    if (!bySlug) requestCache.set(req, entry);
    entry.set(slug, promise);
    return promise;
  }
  return resolve(slug, undefined);
}

async function resolve(
  slug: string,
  req: NextRequest | undefined,
): Promise<FarmContext | null> {
  // 1. Try the fast path first.
  const ctx = await getFarmContext(req);

  // 1a. Fast path gave us the URL slug — happy case, zero extra work.
  if (ctx && ctx.slug === slug) {
    return ctx;
  }

  // 1b. No signed context at all — legacy getServerSession path.
  if (!ctx) {
    const session = await getServerSession(authOptions);
    if (!session) return null;
    return legacyFallback(session, slug);
  }

  // 1c. Fast path gave us a DIFFERENT slug (cookie-vs-URL mismatch). We
  //     already have a valid session from the signed headers — reuse it
  //     for the authorisation check against the URL slug instead of
  //     re-fetching via getServerSession.
  return legacyFallback(ctx.session, slug);
}

async function legacyFallback(
  session: Session,
  slug: string,
): Promise<FarmContext | null> {
  // The synthesised session from getFarmContext() may only carry the
  // active cookie's farm in `user.farms`. That's insufficient for the
  // authorisation check against a *different* URL slug — we need the
  // caller's full farms list from the JWT. Re-issue getServerSession to
  // get the canonical session with all farms populated.
  const farms = session.user?.farms;
  const hasFarm = Array.isArray(farms) && farms.some((f) => f.slug === slug);
  const fullSession = hasFarm ? session : await getServerSession(authOptions);
  if (!fullSession) return null;

  const db = await getPrismaForSlugWithAuth(fullSession, slug);
  if ('error' in db) return null;
  return { session: fullSession, prisma: db.prisma, slug: db.slug, role: db.role };
}
