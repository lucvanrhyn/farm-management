import { createClient, type Client } from '@libsql/client';

let _client: Client | null = null;

function getMetaClient(): Client {
  if (_client) return _client;
  const url = process.env.META_TURSO_URL;
  const authToken = process.env.META_TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    throw new Error(
      'META_TURSO_URL and META_TURSO_AUTH_TOKEN must be set in environment variables.',
    );
  }
  _client = createClient({ url, authToken });
  return _client;
}

export interface MetaUser {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  name: string | null;
}

export interface UserFarm {
  slug: string;
  displayName: string;
  role: string;
  logoUrl: string | null;
}

export interface FarmCreds {
  tursoUrl: string;
  tursoAuthToken: string;
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function getUserByIdentifier(identifier: string): Promise<MetaUser | null> {
  const client = getMetaClient();
  // accepts either email or username
  const result = await client.execute({
    sql: `SELECT id, email, username, password_hash, name
          FROM users
          WHERE email = ? OR username = ?
          LIMIT 1`,
    args: [identifier, identifier],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id as string,
    email: row.email as string,
    username: row.username as string,
    passwordHash: row.password_hash as string,
    name: row.name as string | null,
  };
}

export async function getFarmsForUser(userId: string): Promise<UserFarm[]> {
  const client = getMetaClient();
  const result = await client.execute({
    sql: `SELECT f.slug, f.display_name, fu.role, f.logo_url
          FROM farm_users fu
          JOIN farms f ON f.id = fu.farm_id
          WHERE fu.user_id = ?
          ORDER BY f.display_name`,
    args: [userId],
  });
  return result.rows.map((row) => ({
    slug: row.slug as string,
    displayName: row.display_name as string,
    role: row.role as string,
    logoUrl: row.logo_url as string | null,
  }));
}

export async function getFarmCreds(farmSlug: string): Promise<FarmCreds | null> {
  const client = getMetaClient();
  const result = await client.execute({
    sql: `SELECT turso_url, turso_auth_token FROM farms WHERE slug = ? LIMIT 1`,
    args: [farmSlug],
  });
  if (result.rows.length === 0) return null;
  return {
    tursoUrl: result.rows[0].turso_url as string,
    tursoAuthToken: result.rows[0].turso_auth_token as string,
  };
}

// Checks that a user actually has access to a given farm — used in proxy + API routes
export async function userHasFarmAccess(userId: string, farmSlug: string): Promise<boolean> {
  const client = getMetaClient();
  const result = await client.execute({
    sql: `SELECT 1 FROM farm_users fu
          JOIN farms f ON f.id = fu.farm_id
          WHERE fu.user_id = ? AND f.slug = ?
          LIMIT 1`,
    args: [userId, farmSlug],
  });
  return result.rows.length > 0;
}
