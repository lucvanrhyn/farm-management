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
  email: string | null;
  username: string;
  passwordHash: string;
  name: string | null;
}

export interface UserFarm {
  slug: string;
  displayName: string;
  role: string;
  logoUrl: string | null;
  tier: string;
}

export interface FarmCreds {
  tursoUrl: string;
  tursoAuthToken: string;
  tier: string;
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
    email: (row.email as string) || null,
    username: row.username as string,
    passwordHash: row.password_hash as string,
    name: row.name as string | null,
  };
}

export async function getFarmsForUser(userId: string): Promise<UserFarm[]> {
  const client = getMetaClient();
  const result = await client.execute({
    sql: `SELECT f.slug, f.display_name, fu.role, f.logo_url, f.tier
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
    tier: row.tier as string,
  }));
}

export async function getFarmCreds(farmSlug: string): Promise<FarmCreds | null> {
  const client = getMetaClient();
  const result = await client.execute({
    sql: `SELECT turso_url, turso_auth_token, tier FROM farms WHERE slug = ? LIMIT 1`,
    args: [farmSlug],
  });
  if (result.rows.length === 0) return null;
  return {
    tursoUrl: result.rows[0].turso_url as string,
    tursoAuthToken: result.rows[0].turso_auth_token as string,
    tier: result.rows[0].tier as string,
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

export async function getUserByEmail(email: string): Promise<MetaUser | null> {
  const client = getMetaClient();
  const result = await client.execute({
    sql: `SELECT id, email, username, password_hash, name
          FROM users WHERE email = ? LIMIT 1`,
    args: [email],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id as string,
    email: (row.email as string) || null,
    username: row.username as string,
    passwordHash: row.password_hash as string,
    name: row.name as string | null,
  };
}

export async function getFarmBySlug(slug: string): Promise<{ id: string; slug: string } | null> {
  const client = getMetaClient();
  const result = await client.execute({
    sql: `SELECT id, slug FROM farms WHERE slug = ? LIMIT 1`,
    args: [slug],
  });
  if (result.rows.length === 0) return null;
  return {
    id: result.rows[0].id as string,
    slug: result.rows[0].slug as string,
  };
}

// ── Write operations (registration / provisioning) ──────────────────────────

export async function createUser(
  id: string,
  email: string | null,
  username: string,
  passwordHash: string,
  name: string,
  preVerified = false,
): Promise<void> {
  const client = getMetaClient();
  // No email → auto-verified. preVerified=true for admin-provisioned users.
  // Self-service registrations (email present, preVerified=false) require email confirmation.
  const emailVerified = !email || preVerified ? 1 : 0;
  await client.execute({
    sql: `INSERT OR IGNORE INTO users (id, email, username, password_hash, name, email_verified, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, email, username, passwordHash, name, emailVerified, new Date().toISOString()],
  });
}

export async function createFarm(
  id: string,
  slug: string,
  displayName: string,
  tursoUrl: string,
  tursoAuthToken: string,
  tier: string,
): Promise<void> {
  const client = getMetaClient();
  await client.execute({
    sql: `INSERT INTO farms (id, slug, display_name, turso_url, turso_auth_token, tier, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, slug, displayName, tursoUrl, tursoAuthToken, tier, new Date().toISOString()],
  });
}

export async function createFarmUser(
  userId: string,
  farmId: string,
  role: string,
): Promise<void> {
  const client = getMetaClient();
  await client.execute({
    sql: `INSERT INTO farm_users (user_id, farm_id, role) VALUES (?, ?, ?)`,
    args: [userId, farmId, role],
  });
}

// ── Email verification helpers ──────────────────────────────────────────────

export async function setVerificationToken(
  userId: string,
  token: string,
  expiresAt: string,
): Promise<void> {
  const client = getMetaClient();
  await client.execute({
    sql: `UPDATE users SET verification_token = ?, verification_expires = ? WHERE id = ?`,
    args: [token, expiresAt, userId],
  });
}

export async function verifyUserEmail(token: string): Promise<{ userId: string } | null> {
  const client = getMetaClient();
  const result = await client.execute({
    sql: `SELECT id FROM users
          WHERE verification_token = ?
            AND verification_expires > ?
          LIMIT 1`,
    args: [token, new Date().toISOString()],
  });
  if (result.rows.length === 0) return null;

  const userId = result.rows[0].id as string;
  await client.execute({
    sql: `UPDATE users SET email_verified = 1, verification_token = NULL, verification_expires = NULL WHERE id = ?`,
    args: [userId],
  });
  return { userId };
}

export async function isEmailVerified(userId: string): Promise<boolean> {
  const client = getMetaClient();
  const result = await client.execute({
    sql: `SELECT email_verified FROM users WHERE id = ? LIMIT 1`,
    args: [userId],
  });
  if (result.rows.length === 0) return false;
  return (result.rows[0].email_verified as number) === 1;
}
