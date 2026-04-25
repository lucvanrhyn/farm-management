import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";
import { cookies, headers } from "next/headers";
import { getFarmCreds } from "@/lib/meta-db";
import { getCachedFarmCreds, evictFarmCreds } from "@/lib/farm-creds-cache";
import { recordTiming, getTimingBag } from "@/lib/server/server-timing";
import { recordFarmDbRegion } from "@/lib/server/region-timing";
import { logger } from "@/lib/logger";
import type { Session } from "next-auth";
import type { SessionFarm } from "@/types/next-auth";

// Cache Prisma clients per farm slug to avoid creating a new connection on
// every request. Uses globalThis so the cache survives Next.js hot-reload.
//
// Note: there is intentionally NO eager `SELECT 1` probe on this path.
// The previous implementation ran a probe every 5 minutes, taxing the happy
// path with a serial round-trip before real work. The probe never actually
// prevented token-expiry errors — queries between probe windows still failed
// with 401. Correctness is now on the error path: `withFarmPrisma` catches
// libSQL auth failures, evicts the cached client + credentials, and retries
// once against a freshly-loaded client. Callers that use `getPrismaForFarm`
// directly surface the 401 to their own handler (same behaviour as before,
// minus the wasted probes).
const globalForPrisma = globalThis as unknown as {
  farmClients?: Map<string, PrismaClient>;
  inflightCreation?: Map<string, Promise<PrismaClient | null>>;
};
if (!globalForPrisma.farmClients) globalForPrisma.farmClients = new Map();
if (!globalForPrisma.inflightCreation) globalForPrisma.inflightCreation = new Map();

const AUTH_ERROR_MESSAGES = [
  "401",
  "unauthorized",
  "invalid token",
  "expired",
  "authentication",
  "sqlite_auth",
];

export function isTokenExpiredError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = String((err as Record<string, unknown>).code ?? "").toLowerCase();
  const msg = String((err as Record<string, unknown>).message ?? "").toLowerCase();
  if (code === "server_error" && (msg.includes("401") || msg.includes("unauthorized"))) {
    return true;
  }
  if (code === "token_expired" || code === "sqlite_auth") return true;
  return AUTH_ERROR_MESSAGES.some((needle) => msg.includes(needle));
}

async function createFarmClient(slug: string): Promise<PrismaClient | null> {
  // Deduplicate concurrent creation requests for the same slug.
  const inflight = globalForPrisma.inflightCreation!.get(slug);
  if (inflight) return inflight;

  const promise = (async () => {
    const creds = await getCachedFarmCreds(slug, getFarmCreds);
    if (!creds) return null;
    // Phase E: tag the request with the farm's Turso region so the bench
    // harness + Lighthouse CI can detect any farm still served from the
    // legacy primary after the cutover. No-op off the request path.
    recordFarmDbRegion(creds.tursoUrl);
    const libsql = createClient({ url: creds.tursoUrl, authToken: creds.tursoAuthToken });
    const adapter = new PrismaLibSQL(libsql);
    const client = new PrismaClient({ adapter });
    globalForPrisma.farmClients!.set(slug, client);
    return client;
  })();

  globalForPrisma.inflightCreation!.set(slug, promise);
  try {
    return await promise;
  } finally {
    globalForPrisma.inflightCreation!.delete(slug);
  }
}

/**
 * Resolve a scoped Prisma client for the given farm slug.
 *
 * Consider using `withFarmPrisma(slug, fn)` instead for new code — it adds
 * automatic one-shot retry on token-expiry errors. This bare accessor is
 * preserved for backward compatibility with existing call sites.
 *
 * Observability: when a request-scoped timing bag is active (see
 * `lib/server/server-timing.ts`), the client-acquisition duration is
 * recorded under the `prisma-acquire` label. Zero overhead when no bag
 * is active — the timing probe is a single AsyncLocalStorage lookup that
 * returns `undefined` and short-circuits.
 */
export async function getPrismaForFarm(slug: string): Promise<PrismaClient | null> {
  const cached = globalForPrisma.farmClients!.get(slug);
  if (cached) return cached;

  // Only pay the `performance.now()` cost when there's a bag to write to.
  if (!getTimingBag()) return createFarmClient(slug);

  const start = performance.now();
  try {
    return await createFarmClient(slug);
  } finally {
    recordTiming("prisma-acquire", performance.now() - start);
  }
}

/**
 * Run a Prisma query against a farm's database with auto-retry on token
 * expiry. If the callback throws a libSQL auth error (401 / token expired),
 * the cached client and credentials are evicted, a fresh client is
 * constructed, and the callback runs once more. Any other error — or a
 * second auth error on retry — propagates to the caller.
 *
 * Prefer this over calling `getPrismaForFarm` + running queries directly;
 * it handles the Turso credential-rotation edge case without exposing it
 * to application code.
 */
export async function withFarmPrisma<T>(
  slug: string,
  fn: (prisma: PrismaClient) => Promise<T>,
): Promise<T> {
  const client = await getPrismaForFarm(slug);
  if (!client) {
    throw new Error(`withFarmPrisma: farm "${slug}" not found`);
  }
  try {
    return await fn(client);
  } catch (err) {
    if (!isTokenExpiredError(err)) throw err;
    logger.warn('[farm-prisma] auth error — evicting client + creds and retrying once', { slug });
    evictFarmClient(slug);
    evictFarmCreds(slug);
    const fresh = await createFarmClient(slug);
    if (!fresh) throw err;
    return await fn(fresh);
  }
}

/**
 * Evict a cached Prisma client for a farm slug.
 * Call this when a query fails with a 401 (expired token) so the next
 * request fetches fresh credentials from the meta DB.
 */
export function evictFarmClient(slug: string): void {
  globalForPrisma.farmClients!.delete(slug);
}

const FARM_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
// First path segment after a Referer origin when the user is inside a farm shell.
// Must stay in sync with proxy.ts's farmRouteMatch regex.
const REFERER_SLUG_RE = /^\/([^/]+)\/(admin|dashboard|logger|home|tools|sheep|game)/;

function slugFromReferer(referer: string | null): string | null {
  if (!referer) return null;
  try {
    const { pathname } = new URL(referer);
    const match = pathname.match(REFERER_SLUG_RE);
    if (!match) return null;
    const slug = match[1];
    return FARM_SLUG_RE.test(slug) ? slug : null;
  } catch {
    return null;
  }
}

// Reads active_farm_slug cookie and returns a scoped Prisma client.
// Falls back to parsing the slug out of the Referer header when the cookie is
// missing — needed because the PWA service worker can serve a cached shell for
// /[farmSlug]/* routes without ever letting proxy.ts refresh the cookie. The
// caller (getPrismaWithAuth) still enforces that the session user has access
// to the resolved slug, so Referer spoofing cannot widen access.
export async function getPrismaForRequest(): Promise<
  { prisma: PrismaClient; slug: string } | { error: string; status: number }
> {
  const cookieStore = await cookies();
  let slug = cookieStore.get("active_farm_slug")?.value;
  if (!slug) {
    const headerStore = await headers();
    slug = slugFromReferer(headerStore.get("referer")) ?? undefined;
  }
  if (!slug) return { error: "No active farm selected", status: 400 };
  const prisma = await getPrismaForFarm(slug);
  if (!prisma) return { error: "Farm not found", status: 404 };
  return { prisma, slug };
}

// Same as getPrismaForRequest but also verifies the user has access to the
// farm selected by the cookie. Returns the farm's role for the session user.
// Use this in all cookie-scoped API routes (no [farmSlug] in path).
export async function getPrismaWithAuth(
  session: Session,
): Promise<
  { prisma: PrismaClient; slug: string; role: string } | { error: string; status: number }
> {
  const result = await getPrismaForRequest();
  if ("error" in result) return result;

  const farms = session.user?.farms as SessionFarm[] | undefined;
  const farm = farms?.find((f) => f.slug === result.slug);
  if (!farm) return { error: "Forbidden", status: 403 };

  return { ...result, role: farm.role };
}

// Like getPrismaWithAuth but uses an explicit slug (for [farmSlug] URL routes)
// rather than the active_farm_slug cookie. This prevents cookie/URL mismatch
// where the cookie points to farm A but the URL is for farm B.
export async function getPrismaForSlugWithAuth(
  session: Session,
  slug: string,
): Promise<
  { prisma: PrismaClient; slug: string; role: string } | { error: string; status: number }
> {
  if (!FARM_SLUG_RE.test(slug)) {
    return { error: "Invalid farm slug", status: 400 };
  }

  const farms = session.user?.farms as SessionFarm[] | undefined;
  const farm = farms?.find((f) => f.slug === slug);
  if (!farm) return { error: "Forbidden", status: 403 };

  const prisma = await getPrismaForFarm(slug);
  if (!prisma) return { error: "Farm not found", status: 404 };

  return { prisma, slug, role: farm.role };
}

// Test-only hook. Never call from app code.
export function __clearFarmClientCache(): void {
  globalForPrisma.farmClients!.clear();
  globalForPrisma.inflightCreation!.clear();
}
