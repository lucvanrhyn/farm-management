/**
 * __tests__/helpers/mem-tenant.ts
 *
 * Builds a real, fully-schema'd per-tenant PrismaClient backed by an in-memory
 * libSQL database — the same driver-adapter stack production uses. The DDL is
 * the canonical FARM_SCHEMA_SQL (lib/farm-schema.ts), i.e. the exact bootstrap
 * a freshly-provisioned tenant receives, so reader functions run end-to-end
 * against the true column shape — crucially the `Observation.animalId` /
 * `Transaction.animalId` columns store the animal TAG (Animal.animalId), NOT
 * the cuid Animal.id.
 *
 * Why a real engine instead of a hand-rolled stub: the cuid/tag join bug class
 * is INVISIBLE to stubs. A stub that returns rows regardless of the where
 * clause hides the very mismatch under test; a stub that emulates `where`
 * filtering is just a second, untested re-implementation of the engine. A real
 * libSQL DB honours `where: { animalId: { in: [...] } }` exactly as production
 * does, so a reader that filters Observation rows by Animal.id (a cuid) really
 * does match nothing — the test fails for the same reason prod was silently
 * broken. This is the regression lock the bug class never had.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";
import { FARM_SCHEMA_SQL } from "@/lib/farm-schema";

/** Split the canonical bootstrap DDL into executable statements. Mirrors
 *  lib/migrator.ts splitSqlStatements: strip line comments, split on ';'. */
function ddlStatements(sql: string): string[] {
  const stripped = sql
    .split("\n")
    .map((line) => {
      const i = line.indexOf("--");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
  return stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Create a PrismaClient over a fresh in-memory tenant DB seeded with the
 * canonical schema. Each call is an isolated, empty tenant.
 *
 * Remember to `await prisma.$disconnect()` in the test's afterEach/finally.
 */
export async function makeTenantPrisma(): Promise<PrismaClient> {
  const client = createClient({ url: ":memory:" });
  for (const stmt of ddlStatements(FARM_SCHEMA_SQL)) {
    await client.execute(stmt);
  }
  return new PrismaClient({ adapter: new PrismaLibSQL(client) });
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Date `n` days before now. */
export const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY_MS);
/** Date `n` days after now. */
export const daysAhead = (n: number): Date => new Date(Date.now() + n * DAY_MS);
/** ISO YYYY-MM-DD `n` days before now. */
export const isoDaysAgo = (n: number): string => daysAgo(n).toISOString().slice(0, 10);
