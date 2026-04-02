import { createClient } from '@libsql/client';
import { FARM_SCHEMA_SQL } from './farm-schema';

/**
 * Applies the full schema and seeds FarmSettings on a newly provisioned farm database.
 */
export async function seedFarmDatabase(
  url: string,
  token: string,
  farmName: string,
): Promise<void> {
  const client = createClient({ url, authToken: token });

  // Apply schema (CREATE TABLEs + indexes)
  await client.executeMultiple(FARM_SCHEMA_SQL);

  // Seed initial FarmSettings row (tier is managed in meta-db only)
  await client.execute({
    sql: `INSERT INTO FarmSettings (id, farmName, breed, updatedAt)
          VALUES ('singleton', ?, 'Mixed', datetime('now'))`,
    args: [farmName],
  });
}
