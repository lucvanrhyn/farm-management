import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";
import { cookies } from "next/headers";
import { getFarmCreds } from "@/lib/meta-db";

export async function getPrismaForFarm(slug: string): Promise<PrismaClient | null> {
  const creds = await getFarmCreds(slug);
  if (!creds) return null;
  const libsql = createClient({ url: creds.tursoUrl, authToken: creds.tursoAuthToken });
  const adapter = new PrismaLibSQL(libsql);
  return new PrismaClient({ adapter });
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
