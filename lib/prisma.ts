import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient(): PrismaClient {
  if (process.env.TURSO_DATABASE_URL) {
    const libsql = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    const adapter = new PrismaLibSQL(libsql);
    // Pass a dummy datasources override so Prisma doesn't require DATABASE_URL
    // from the environment — the adapter handles the actual connection.
    return new PrismaClient({ adapter, datasources: { db: { url: "file:./dummy.db" } } });
  }
  return new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
