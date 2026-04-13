import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";
import { cookies, headers } from "next/headers";
import { getFarmCreds } from "@/lib/meta-db";
import type { Session } from "next-auth";
import type { SessionFarm } from "@/types/next-auth";

// Cache Prisma clients per farm slug to avoid creating a new connection on every request.
// Uses globalThis so the cache survives Next.js hot-reload in development.
const globalForPrisma = globalThis as unknown as {
  farmClients?: Map<string, PrismaClient>;
  lastValidated?: Map<string, number>;
  inflightCreation?: Map<string, Promise<PrismaClient | null>>;
};
if (!globalForPrisma.farmClients) globalForPrisma.farmClients = new Map();
if (!globalForPrisma.lastValidated) globalForPrisma.lastValidated = new Map();
if (!globalForPrisma.inflightCreation) globalForPrisma.inflightCreation = new Map();

const VALIDATION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function isTokenExpiredError(err: unknown): boolean {
  const msg = String((err as Record<string, unknown>)?.message ?? "");
  const code = String((err as Record<string, unknown>)?.code ?? "");
  // Turso/libSQL wraps 401 responses as SERVER_ERROR with "401" in the message
  if (code === "SERVER_ERROR" && (msg.includes("401") || msg.toLowerCase().includes("unauthorized"))) return true;
  return false;
}

async function createFarmClient(slug: string): Promise<PrismaClient | null> {
  // Deduplicate concurrent creation requests for the same slug
  const inflight = globalForPrisma.inflightCreation!.get(slug);
  if (inflight) return inflight;

  const promise = (async () => {
    const creds = await getFarmCreds(slug);
    if (!creds) return null;
    const libsql = createClient({ url: creds.tursoUrl, authToken: creds.tursoAuthToken });
    const adapter = new PrismaLibSQL(libsql);
    const client = new PrismaClient({ adapter });
    globalForPrisma.farmClients!.set(slug, client);
    globalForPrisma.lastValidated!.set(slug, Date.now());
    return client;
  })();

  globalForPrisma.inflightCreation!.set(slug, promise);
  try {
    return await promise;
  } finally {
    globalForPrisma.inflightCreation!.delete(slug);
  }
}

export async function getPrismaForFarm(slug: string): Promise<PrismaClient | null> {
  const cached = globalForPrisma.farmClients!.get(slug);
  if (cached) {
    const now = Date.now();
    const lastCheck = globalForPrisma.lastValidated!.get(slug) ?? 0;
    if (now - lastCheck > VALIDATION_INTERVAL_MS) {
      try {
        await cached.$queryRawUnsafe("SELECT 1");
        globalForPrisma.lastValidated!.set(slug, now);
      } catch (err) {
        // Update timestamp on any error to prevent probe storms on transient failures
        globalForPrisma.lastValidated!.set(slug, now);
        if (isTokenExpiredError(err)) {
          console.warn(`[farm-prisma] Token expired for "${slug}", evicting cached client`);
          evictFarmClient(slug);
          return createFarmClient(slug);
        }
        throw err;
      }
    }
    return cached;
  }

  return createFarmClient(slug);
}

/**
 * Evict a cached Prisma client for a farm slug.
 * Call this when a query fails with a 401 (expired token) so the next
 * request fetches fresh credentials from the meta DB.
 */
export function evictFarmClient(slug: string): void {
  globalForPrisma.farmClients!.delete(slug);
  globalForPrisma.lastValidated!.delete(slug);
}

// Farm-slug validator mirrors the one in getPrismaForSlugWithAuth.
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
// Returns { error, status } if neither source yields a slug or the farm is not found.
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
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
    return { error: "Invalid farm slug", status: 400 };
  }

  const farms = session.user?.farms as SessionFarm[] | undefined;
  const farm = farms?.find((f) => f.slug === slug);
  if (!farm) return { error: "Forbidden", status: 403 };

  const prisma = await getPrismaForFarm(slug);
  if (!prisma) return { error: "Farm not found", status: 404 };

  return { prisma, slug, role: farm.role };
}
