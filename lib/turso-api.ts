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

export interface CreateTursoDatabaseOptions {
  // Turso location code (e.g. "fra" Frankfurt, "nrt" Tokyo, "iad" US East).
  // If omitted, falls back to `FARM_DEFAULT_TURSO_LOCATION` env, then "fra"
  // (the Phase E target). Keeping this explicit lets operators stage a
  // migration by provisioning a handful of farms into a non-default region
  // without flipping the env var for everyone.
  location?: string;
}

const DEFAULT_LOCATION = 'fra';

function resolveLocation(opts?: CreateTursoDatabaseOptions): string {
  if (opts?.location) return opts.location;
  const fromEnv = process.env.FARM_DEFAULT_TURSO_LOCATION;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return DEFAULT_LOCATION;
}

/**
 * Creates a new Turso database in the requested region and returns its
 * URL + auth token. Schema is applied separately after creation via
 * seed-farm-db.
 */
export async function createTursoDatabase(
  dbName: string,
  opts?: CreateTursoDatabaseOptions,
): Promise<ProvisionedDatabase> {
  const turso = getTursoClient();

  // NOTE: the `location` property is supported by the Turso platform API but
  // is not yet surfaced in `@tursodatabase/api`'s typings at the version we
  // have pinned. The runtime field is honoured — we cast rather than wait
  // for the upstream type bump.
  const created = await turso.databases.create(dbName, {
    group: 'default',
    location: resolveLocation(opts),
  } as Parameters<typeof turso.databases.create>[1] & { location: string });

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
