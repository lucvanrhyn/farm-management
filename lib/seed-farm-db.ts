import { createClient } from '@libsql/client';
import { FARM_SCHEMA_SQL, BASELINE_MIGRATION_NAMES } from './farm-schema';
import { stampMigrationsApplied } from './migrator';

/**
 * Applies the full schema and seeds FarmSettings on a newly provisioned farm database.
 *
 * The bootstrap DDL (`FARM_SCHEMA_SQL`) is generated from prisma/schema.prisma
 * and already reflects every numbered migration's effect, so we stamp those
 * migrations as applied in `_migrations` (without running them). This makes a
 * later `pnpm db:migrate` a correct no-op for this tenant — see
 * `stampMigrationsApplied` for the full rationale.
 */
export async function seedFarmDatabase(
  url: string,
  token: string,
  farmName: string,
): Promise<void> {
  const client = createClient({ url, authToken: token });

  // Apply schema (CREATE TABLEs + indexes)
  await client.executeMultiple(FARM_SCHEMA_SQL);

  // Stamp the baseline migrations so future `pnpm db:migrate` skips them.
  await stampMigrationsApplied(client, BASELINE_MIGRATION_NAMES);

  // Seed initial FarmSettings row (tier is managed in meta-db only)
  await client.execute({
    sql: `INSERT INTO FarmSettings (id, farmName, breed, updatedAt)
          VALUES ('singleton', ?, 'Mixed', datetime('now'))`,
    args: [farmName],
  });
}
