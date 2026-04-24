import { createClient } from '@tursodatabase/api';
import { TURSO_REGIONS, type TursoRegion } from '@/lib/turso-region';

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
  // Turso location. Accepts either:
  //   - a short code from `TursoRegion` (e.g. "dub" Ireland, "nrt" Tokyo), which
  //     we translate to the full AWS ID the mgmt API requires, OR
  //   - a full AWS region ID (e.g. "aws-eu-west-1") passed through verbatim.
  //
  // The 2026-04-24 Turso platform only accepts full AWS IDs (`aws-<region>`)
  // from the mgmt API — their SDK's legacy 3-letter codes (`fra`, `lhr`, etc.)
  // silently fail provisioning. Keep the translation here so callers can keep
  // using the friendly short codes that `lib/turso-region.ts` already exposes.
  //
  // If omitted, falls back to `FARM_DEFAULT_TURSO_LOCATION` env, then "dub"
  // (the current Phase E target). Keeping this explicit lets operators stage
  // a migration by provisioning individual farms into a non-default region
  // without flipping the env var for everyone.
  location?: TursoRegion | string;
  // Turso group name. Since mid-2026 Turso no longer supports multi-region
  // groups on AWS (edge replicas were deprecated), each region must live in
  // its own group whose primary location matches the region. Callers who
  // pass `location` without `group` get the group inferred from the region
  // via a registry in this module.
  group?: string;
}

const DEFAULT_LOCATION: TursoRegion = 'dub';

/**
 * Map each Turso short-code region to the single-location group that hosts
 * DBs in that region. Kept in one place so every caller stays consistent.
 *
 * When Turso retired multi-region replication on AWS (see
 * https://tur.so/replicas-deprecated), each region ended up with its own
 * group whose primary is the target AWS location. The operator provisions
 * the group once via `turso group create <name> --location aws-<region>`.
 */
const GROUP_BY_REGION: Partial<Record<TursoRegion, string>> = {
  nrt: 'default', // legacy Tokyo group
  dub: 'eu-dub', // Ireland — Phase E target (2026-04)
};

/**
 * Turso mgmt API locations format (`aws-eu-west-1`) is the source of truth.
 * We accept either form from callers: short-code → translate, full ID →
 * pass through. Unknown short codes throw loudly rather than silently
 * forwarding a rejected value.
 */
function toAwsLocationId(raw: string): string {
  if (raw.startsWith('aws-')) return raw;
  const hit = TURSO_REGIONS.find((r) => r.code === raw);
  if (!hit) {
    throw new Error(
      `Unknown Turso region "${raw}". Pass a full AWS ID (e.g. "aws-eu-west-1") ` +
        `or a registered short code (${TURSO_REGIONS.map((r) => r.code).join(', ')}).`,
    );
  }
  return `aws-${hit.awsRegion}`;
}

function resolveLocation(opts?: CreateTursoDatabaseOptions): string {
  const raw = opts?.location ?? process.env.FARM_DEFAULT_TURSO_LOCATION ?? DEFAULT_LOCATION;
  return toAwsLocationId(raw);
}

function resolveGroup(opts?: CreateTursoDatabaseOptions): string {
  if (opts?.group) return opts.group;
  const raw = opts?.location ?? process.env.FARM_DEFAULT_TURSO_LOCATION ?? DEFAULT_LOCATION;
  // Short-code → group. Full AWS IDs also map via their short form.
  const short = raw.startsWith('aws-')
    ? (TURSO_REGIONS.find((r) => `aws-${r.awsRegion}` === raw)?.code ?? null)
    : (raw as TursoRegion);
  const group = short ? GROUP_BY_REGION[short] : undefined;
  if (!group) {
    throw new Error(
      `No Turso group registered for region "${raw}". Add it to GROUP_BY_REGION ` +
        `in lib/turso-api.ts after creating the group via ` +
        `\`turso group create <name> --location aws-<region>\`.`,
    );
  }
  return group;
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
  // for the upstream type bump. The `group` must be a single-location group
  // whose primary matches `location` (Turso no longer supports multi-region
  // groups on AWS).
  const created = await turso.databases.create(dbName, {
    group: resolveGroup(opts),
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
