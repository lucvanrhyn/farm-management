/**
 * lib/ops/seed-test-admin.ts — idempotent test-admin meta-DB seed (code half
 * of the #108 gate, issue #527, PRD #521).
 *
 * Inserts a verified ADMIN user into the meta DB and links it to an EXISTING
 * tenant, so an AFK / CI agent can authenticate against a real branch clone
 * without hand-provisioning credentials. Mirrors the canonical meta-DB shape
 * and registration semantics:
 *
 *   - password hashed with bcrypt cost 12 (matches app/api/auth/register/route.ts).
 *   - email_verified = 1 (a verified account, ready to log in).
 *   - INSERT OR IGNORE on both rows → safe to re-run.
 *
 * This is the deep, injectable core: it takes a libSQL-style `execute` client
 * so it is unit-testable against an in-memory DB. The thin CLI wrapper
 * `scripts/seed-test-admin.ts` wires env vars + the real `@libsql/client`.
 *
 * It NEVER creates farms — the target tenant must already exist (the script
 * maps a login onto a real branch clone, it does not provision one). It is
 * gated to non-prod tenants: the real client tenant `basson-boerdery` is
 * refused unless `force: true` is passed explicitly.
 */

import { hashSync } from 'bcryptjs';
import { randomUUID } from 'crypto';
import type { InStatement, ResultSet } from '@libsql/client';

/**
 * Tenants that must never be seeded with a synthetic admin without an explicit
 * `force` override. `basson-boerdery` is the live first-client tenant.
 */
export const PROD_FARM_SLUGS: readonly string[] = ['basson-boerdery'];

/** bcrypt work factor — must match app/api/auth/register/route.ts. */
const BCRYPT_COST = 12;

/** The role granted to the seeded user on the target tenant. */
const SEED_ROLE = 'ADMIN';

export interface SeedTestAdminInput {
  email: string;
  password: string;
  farmSlug: string;
  /** Bypass the PROD_FARM_SLUGS guard. Operator opt-in only. */
  force?: boolean;
}

/**
 * Structural subset of `@libsql/client`'s `Client` — just the `execute`
 * surface this module needs. We reuse libSQL's own `InStatement`/`ResultSet`
 * types so the real client (and an in-memory test client) are both assignable
 * without any cast, while keeping the dependency one-directional (this module
 * never constructs a client — the caller injects one).
 */
export interface MetaExecClient {
  execute(stmt: InStatement): Promise<ResultSet>;
}

export interface SeedTestAdminResult {
  userId: string;
  farmId: string;
  /** True if this invocation created the user row (false on re-run). */
  createdUser: boolean;
  /** True if this invocation created the farm_users row (false on re-run). */
  createdMembership: boolean;
}

/** Raised on any refusal/precondition failure. Caller maps to a non-zero exit. */
export class TestAdminSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestAdminSeedError';
  }
}

/**
 * Derive a stable, register-route-valid username from an email local-part.
 * Deterministic so re-runs produce the same username (idempotency depends on
 * the UNIQUE email/username columns, but a stable username keeps re-runs
 * predictable and collision-free for the same email).
 *
 * Sanitizes to the register route's allowed charset `[a-zA-Z0-9_-]` and pads
 * short results to the 3-char minimum.
 */
export function deriveUsername(email: string): string {
  const local = email.split('@')[0] ?? '';
  const sanitized = local.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const base = sanitized.length > 0 ? sanitized : 'admin';
  return base.length >= 3 ? base : `${base}-qa`;
}

/**
 * Seed (or re-confirm) a verified ADMIN user against an existing tenant.
 *
 * @throws TestAdminSeedError if the slug is prod-reserved (without `force`) or
 *         the tenant does not exist.
 */
export async function seedTestAdmin(
  client: MetaExecClient,
  input: SeedTestAdminInput,
): Promise<SeedTestAdminResult> {
  const { email, password, farmSlug, force = false } = input;

  // 1. Non-prod guard — fires before any DB call.
  if (PROD_FARM_SLUGS.includes(farmSlug) && !force) {
    throw new TestAdminSeedError(
      `Refusing to seed a test admin onto the production tenant '${farmSlug}'. ` +
        `Pass force:true (SEED_TEST_ADMIN_FORCE=1) only if you are certain.`,
    );
  }

  // 2. Resolve the farm — must already exist; this script never creates farms.
  const farmRes = await client.execute({
    sql: 'SELECT id FROM farms WHERE slug = ?',
    args: [farmSlug],
  });
  if (farmRes.rows.length === 0) {
    throw new TestAdminSeedError(
      `Tenant '${farmSlug}' not found in the meta DB. ` +
        `This script maps a login onto an existing tenant — provision the farm first.`,
    );
  }
  const farmId = String(farmRes.rows[0].id);

  // 3. INSERT OR IGNORE the verified, bcrypt-cost-12 user.
  const passwordHash = hashSync(password, BCRYPT_COST);
  const username = deriveUsername(email);
  const userInsert = await client.execute({
    sql: `INSERT OR IGNORE INTO users
            (id, email, username, password_hash, name, email_verified, created_at)
          VALUES (?, ?, ?, ?, ?, 1, ?)`,
    args: [randomUUID(), email, username, passwordHash, username, new Date().toISOString()],
  });
  const createdUser = (userInsert.rowsAffected ?? 0) > 0;

  // 4. Re-SELECT to resolve the real userId — handles the re-run case where
  //    INSERT OR IGNORE skipped (existing row keeps its original id).
  const userRes = await client.execute({
    sql: 'SELECT id FROM users WHERE email = ?',
    args: [email],
  });
  if (userRes.rows.length === 0) {
    // Should be unreachable — we just inserted-or-found by the UNIQUE email.
    throw new TestAdminSeedError(`Failed to resolve seeded user '${email}' after insert.`);
  }
  const userId = String(userRes.rows[0].id);

  // 5. INSERT OR IGNORE the ADMIN membership row.
  const membershipInsert = await client.execute({
    sql: 'INSERT OR IGNORE INTO farm_users (user_id, farm_id, role) VALUES (?, ?, ?)',
    args: [userId, farmId, SEED_ROLE],
  });
  const createdMembership = (membershipInsert.rowsAffected ?? 0) > 0;

  return { userId, farmId, createdUser, createdMembership };
}
