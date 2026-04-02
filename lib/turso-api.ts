import { createClient } from '@tursodatabase/api';

function getTursoClient() {
  const token = process.env.TURSO_API_TOKEN;
  const org = process.env.TURSO_ORG;
  if (!token || !org) {
    throw new Error('TURSO_API_TOKEN and TURSO_ORG must be set in environment variables.');
  }
  return createClient({ org, token });
}

export interface ProvisionedDatabase {
  url: string;
  token: string;
}

/**
 * Creates a new Turso database and returns its URL + auth token.
 * Schema is applied separately after creation via seed-farm-db.
 */
export async function createTursoDatabase(dbName: string): Promise<ProvisionedDatabase> {
  const turso = getTursoClient();

  const created = await turso.databases.create(dbName, {
    group: 'default',
  });

  const tokenResult = await turso.databases.createToken(dbName, {
    authorization: 'full-access',
  });

  return {
    url: `libsql://${created.hostname}`,
    token: tokenResult.jwt,
  };
}

/**
 * Deletes a Turso database. Used for cleanup when provisioning fails after DB creation.
 */
export async function deleteTursoDatabase(dbName: string): Promise<void> {
  const turso = getTursoClient();
  await turso.databases.delete(dbName);
}
