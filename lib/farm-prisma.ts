import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";
import { cookies } from "next/headers";
import { getFarmCreds } from "@/lib/meta-db";
import type { Session } from "next-auth";

// Cache Prisma clients per farm slug to avoid creating a new connection on every request.
// Uses globalThis so the cache survives Next.js hot-reload in development.
const globalForPrisma = globalThis as unknown as { farmClients?: Map<string, PrismaClient> };
if (!globalForPrisma.farmClients) globalForPrisma.farmClients = new Map();

export async function getPrismaForFarm(slug: string): Promise<PrismaClient | null> {
  const cached = globalForPrisma.farmClients!.get(slug);
  if (cached) return cached;

  const creds = await getFarmCreds(slug);
  if (!creds) return null;
  const libsql = createClient({ url: creds.tursoUrl, authToken: creds.tursoAuthToken });
  const adapter = new PrismaLibSQL(libsql);
  const client = new PrismaClient({ adapter });
  globalForPrisma.farmClients!.set(slug, client);
  return client;
}

/**
 * Evict a cached Prisma client for a farm slug.
 * Call this when a query fails with a 401 (expired token) so the next
 * request fetches fresh credentials from the meta DB.
 */
export function evictFarmClient(slug: string): void {
  globalForPrisma.farmClients!.delete(slug);
}

// Reads active_farm_slug cookie and returns a scoped Prisma client.
// Returns { error, status } if the cookie is missing or the farm is not found.
export async function getPrismaForRequest(): Promise<
  { prisma: PrismaClient; slug: string } | { error: string; status: number }
> {
  const cookieStore = await cookies();
  const slug = cookieStore.get("active_farm_slug")?.value;
  if (!slug) return { error: "No active farm selected", status: 400 };
  const prisma = await getPrismaForFarm(slug);
  if (!prisma) return { error: "Farm not found", status: 404 };
  return { prisma, slug };
}

// Same as getPrismaForRequest but also verifies the user has access to the
// farm selected by the cookie. Use this in all API routes.
export async function getPrismaWithAuth(
  session: Session,
): Promise<
  { prisma: PrismaClient; slug: string } | { error: string; status: number }
> {
  const result = await getPrismaForRequest();
  if ("error" in result) return result;

  const farms = session.user?.farms as Array<{ slug: string }> | undefined;
  if (!farms?.some((f) => f.slug === result.slug)) {
    return { error: "Forbidden", status: 403 };
  }

  return result;
}
