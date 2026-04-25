/**
 * Phase D (P6) — request-scoped auth + Prisma resolver.
 *
 * Every authenticated API route used to perform two serial awaits:
 *
 *   const session = await getServerSession(authOptions);   // ~80-120ms cold
 *   const db = await getPrismaWithAuth(session);           // ~30-60ms cold
 *
 * `proxy.ts` already runs `getToken` for every request that hits the matcher
 * — the full session material is available there. Phase D hoists that work
 * into the middleware hop: proxy authenticates once, stamps an HMAC-signed
 * identity tuple (email, slug, sub, role + version byte) onto the request,
 * and route handlers consume it via `getFarmContext()`.
 *
 * Trust model
 * -----------
 * The signed triplet is ONLY trusted when the HMAC verifies against
 * `NEXTAUTH_SECRET` using `timingSafeEqual`. An unsigned `x-farm-slug`
 * header from a direct fetch (bypassing the middleware) has the same
 * effect as no header at all — the helper falls back to the legacy
 * `getServerSession`/`getPrismaWithAuth` path.
 *
 * Per-request memoisation
 * -----------------------
 * Route handlers sometimes need the Prisma client from more than one
 * place (e.g. a utility helper + the handler body). The resolved context
 * is attached to a per-request WeakMap keyed by the `NextRequest` when
 * one is passed. When callers rely on the `next/headers` idiom instead
 * (no `req` arg), Next.js already memoises `headers()` per-request, so
 * repeated `getFarmContext()` calls within one handler still avoid the
 * fast-path verification twice in the hot sense that matters (the Prisma
 * acquisition is itself globally cached by slug).
 */

import { headers as nextHeaders } from 'next/headers';
import { getServerSession } from 'next-auth';
import type { Session } from 'next-auth';
import type { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { authOptions } from '@/lib/auth-options';
import { getPrismaForFarm, getPrismaWithAuth } from '@/lib/farm-prisma';

export interface FarmContext {
  session: Session;
  prisma: PrismaClient;
  slug: string;
  role: string;
}

// Per-request memoisation cache. The WeakMap allows the resolved context to
// be garbage-collected with the NextRequest object — no manual eviction
// needed. Only used when callers pass `req` explicitly; the `next/headers`
// code path relies on Next.js's own per-request caching for `headers()`.
const requestCache = new WeakMap<NextRequest, Promise<FarmContext | null>>();

const SIGNED_USER_HEADER = 'x-session-user';
const SIGNED_SLUG_HEADER = 'x-farm-slug';
const SIGNED_ROLE_HEADER = 'x-session-role';
const SIGNED_SUB_HEADER = 'x-session-sub';
const SIGNATURE_HEADER = 'x-session-sig';

/**
 * Identity HMAC version. Bumped from implicit v1 → v2 in Wave 1 W1b when
 * `role` was bound into the payload. The version byte lives at the head of
 * the HMAC input so any future rotation (key change, payload change) can be
 * forced by bumping this constant — old tokens fail verification cleanly
 * instead of silently degrading.
 *
 * IMPORTANT: bumping `IDENTITY_HMAC_VERSION` requires `NEXTAUTH_SECRET` to
 * be rotated on the same deploy so all in-flight v(N-1) tokens are rejected
 * and clients are forced to re-auth. v1 tokens are intentionally rejected.
 */
export const IDENTITY_HMAC_VERSION = 'v2';

/**
 * Compute the HMAC-SHA256 signature for (version, userEmail, slug, userId, role).
 * Exported so `proxy.ts` can reuse the exact same primitive when signing and we
 * cannot drift between signer and verifier.
 *
 * Phase G (P6.5): the payload binds the JWT `sub` (user id) so migrated
 * admin-write handlers calling `verifyFreshAdminRole(session.user.id, slug)`
 * receive the real user id instead of an empty string.
 *
 * Wave 1 W1b: payload now also binds `role` and a leading version byte. Role
 * was previously only stamped into a sibling header (`x-session-role`) and
 * not authenticated by the HMAC, leaving a forged-role attack vector at the
 * primitive level. The version byte lets us rotate cleanly in future.
 */
export function signIdentity(
  userEmail: string,
  slug: string,
  userId: string,
  role: string,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`${IDENTITY_HMAC_VERSION}\n${userEmail}\n${slug}\n${userId}\n${role}`)
    .digest('hex');
}

export function verifyIdentity(
  userEmail: string,
  slug: string,
  userId: string,
  role: string,
  providedSig: string,
  secret: string,
): boolean {
  const expected = signIdentity(userEmail, slug, userId, role, secret);
  // Length mismatch would cause `timingSafeEqual` to throw; pre-check.
  if (expected.length !== providedSig.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(providedSig));
  } catch {
    return false;
  }
}

/**
 * Minimal header reader — the only two ways to read request headers inside
 * a route handler. `NextRequest.headers.get` is synchronous; `next/headers`
 * is async (Next 16) but per-request memoised.
 */
type HeaderReader = (name: string) => string | null;

async function readerFromRequest(req: NextRequest | undefined): Promise<HeaderReader> {
  if (req) return (name) => req.headers.get(name);
  try {
    const h = await nextHeaders();
    return (name) => h.get(name);
  } catch {
    // `headers()` throws outside a request scope (tests, background tasks) —
    // fall back to "no headers" so the legacy path runs.
    return () => null;
  }
}

/**
 * Resolve `{session, prisma, slug, role}` for an authenticated request.
 * Returns `null` when the request is unauthenticated or the farm cannot
 * be resolved (legacy helpers would have returned an error object of the
 * same semantic weight; callers turn `null` into a 401).
 *
 * `req` is optional. Passing it is the fastest path (no `next/headers`
 * ALS lookup) and enables per-request memoisation so nested helper calls
 * share a single Prisma acquire. Omitting it lets handlers with the
 * legacy `GET()`/`POST()` signature opt in without a refactor — Next 16's
 * request-scoped `headers()` supplies the same triplet when proxy.ts
 * injected it.
 */
export async function getFarmContext(req?: NextRequest): Promise<FarmContext | null> {
  if (req) {
    const cached = requestCache.get(req);
    if (cached) return cached;
    const promise = resolveFarmContext(req);
    requestCache.set(req, promise);
    return promise;
  }
  return resolveFarmContext(undefined);
}

async function resolveFarmContext(req: NextRequest | undefined): Promise<FarmContext | null> {
  const read = await readerFromRequest(req);
  const secret = process.env.NEXTAUTH_SECRET;
  const userEmail = read(SIGNED_USER_HEADER);
  const slug = read(SIGNED_SLUG_HEADER);
  const sig = read(SIGNATURE_HEADER);
  const signedRole = read(SIGNED_ROLE_HEADER) ?? '';
  const signedSub = read(SIGNED_SUB_HEADER) ?? '';

  // Fast path: proxy.ts already authenticated this request. We MUST NOT
  // trust any of the headers unless the HMAC verifies — otherwise an
  // external caller could spoof tenant identity by sending `x-farm-slug`.
  //
  // Phase G (P6.5): the signed payload binds `sub` (user id) so migrated
  // admin-write handlers can call `verifyFreshAdminRole(userId, slug)`
  // without an empty-string userId silently rejecting every ADMIN.
  //
  // Wave 1 W1b: the payload also binds `role` and a leading `v2` version
  // byte. Role was previously trusted from `x-session-role` outside the
  // HMAC; now any tampered or v1-format token fails verification cleanly.
  // We require a non-empty `signedRole` here — without it the verifier
  // would happily authenticate a token signed with role="" against a
  // forged `x-session-role: ADMIN` header.
  if (
    secret &&
    userEmail &&
    slug &&
    sig &&
    signedSub &&
    signedRole &&
    verifyIdentity(userEmail, slug, signedSub, signedRole, sig, secret)
  ) {
    const prisma = await getPrismaForFarm(slug);
    if (!prisma) return null;
    // Synthesise a minimal Session from the signed headers. Handlers that
    // need the broader session (farms list, role priority) still have
    // `user.id` + `user.email` + `user.role` populated, which covers every
    // `verifyFreshAdminRole(session.user.id, slug)` call site. We keep this
    // lean — no second meta-db round-trip for the full farms list — because
    // each migrated handler already works against a single slug.
    const session = {
      user: {
        id: signedSub,
        email: userEmail,
        username: '',
        role: signedRole,
        farms: [{ slug, role: signedRole } as unknown as Session['user']['farms'][number]],
      },
    } as unknown as Session;
    return { session, prisma, slug, role: signedRole };
  }

  // Legacy path: middleware did not (or could not) authenticate. Fall back
  // to the classic pair. Behaviour is byte-identical to pre-P6 so any route
  // migrated partially is safe.
  const session = await getServerSession(authOptions);
  if (!session) return null;

  const db = await getPrismaWithAuth(session);
  if ('error' in db) return null;

  return {
    session,
    prisma: db.prisma,
    slug: db.slug,
    role: db.role,
  };
}
