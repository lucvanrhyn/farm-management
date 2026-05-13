import { createClient, type Client } from '@libsql/client';
import { logger } from '@/lib/logger';

let _client: Client | null = null;
let hasWarnedAboutPlatformAdminFallback = false;

// There is intentionally NO eager probe on this path. The previous
// implementation ran a SELECT 1 once per 30s to detect token expiry, but
// the window meant any real query hitting an expired token still 401'd
// until the probe re-ran. Correctness is now on the error path:
// `withMetaDb` catches libSQL auth errors, evicts the client, and retries
// once against a fresh client (which re-reads env vars — if the deploy
// rotated the token, the fresh client picks it up). Non-critical callers
// still get `getMetaClient()` directly and surface 401s to their handler.

/** Internal error-classifier shared with `withMetaDb`. */
export function isMetaAuthError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = String((err as Record<string, unknown>).code ?? '').toLowerCase();
  const msg = String((err as Record<string, unknown>).message ?? '').toLowerCase();
  if (code === 'server_error' && (msg.includes('401') || msg.includes('unauthorized'))) {
    return true;
  }
  if (code === 'token_expired' || code === 'sqlite_auth') return true;
  return (
    msg.includes('expired') ||
    msg.includes('invalid token') ||
    msg.includes('unauthorized') ||
    msg.includes('authentication')
  );
}

/**
 * Resolve the singleton meta-DB client, constructing it on first use.
 * Exported so auxiliary modules (telemetry route, helper scripts) can issue
 * simple writes without taking the retry wrapper. Prefer `withMetaDb` for
 * auth-critical reads.
 */
export function getMetaClient(): Client {
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

/**
 * Evict the cached meta client. Subsequent calls will re-read env vars and
 * construct a fresh client with the (hopefully rotated) token.
 */
export function evictMetaClient(): void {
  _client = null;
}

/**
 * Run a meta-DB operation with automatic retry on token-expiry errors.
 * If the callback throws a libSQL auth error, the cached client is evicted,
 * a fresh one is constructed, and the callback runs once more. Any other
 * error — or a second auth error on retry — propagates.
 *
 * Use this for auth-critical paths (login, email verification, tier gates)
 * where a single 401 during Turso credential rotation would block the user.
 */
export async function withMetaDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  try {
    return await fn(getMetaClient());
  } catch (err) {
    if (!isMetaAuthError(err)) throw err;
    logger.warn('[meta-db] auth error — evicting client and retrying once');
    evictMetaClient();
    return await fn(getMetaClient());
  }
}

// Test-only hook. Never call from app code.
export function __resetMetaClient(): void {
  _client = null;
}

// Test-only hook: inject a pre-built client (e.g. in-memory libSQL).
// Never call from app code.
export function __setMetaClientForTest(client: Client): void {
  _client = client;
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
  subscriptionStatus: string;
}

export interface FarmCreds {
  tursoUrl: string;
  tursoAuthToken: string;
  tier: string;
}

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * Auth lookup error codes — typed result codes returned by
 * `findUserByIdentifier`. Kept tight (not the same vocabulary as
 * `AUTH_ERROR_CODES` in `lib/auth-errors.ts`) because the lookup layer
 * only knows about resolution outcomes, not the user-facing copy or the
 * subsequent password / verification checks.
 *
 * NOT_FOUND is the normal "no such user" path. AMBIGUOUS is defence-in-
 * depth: post-migration 0003 the DB unique constraint on `users.username`
 * makes >1 row physically impossible, but if a legacy meta-DB ever
 * surfaces a duplicate, we surface a typed error instead of silently
 * picking the first row.
 */
export const AUTH_LOOKUP_ERROR = {
  NOT_FOUND: 'NOT_FOUND',
  AMBIGUOUS: 'AMBIGUOUS',
} as const;

export type AuthLookupErrorCode =
  (typeof AUTH_LOOKUP_ERROR)[keyof typeof AUTH_LOOKUP_ERROR];

export type FindUserResult =
  | { ok: true; user: MetaUser }
  | { ok: false; code: AuthLookupErrorCode };

/**
 * Resolve a sign-in identifier (USERNAME ONLY) to a meta-DB user.
 *
 * Issue #261 / Wave 6b — replaces the legacy `getUserByIdentifier` (which
 * OR'd `email = ? OR username = ?`). The maintainer-locked HITL contract
 * is documented in `tasks/auth-and-users.md`: sign-in accepts only the
 * username field; the optional `users.email` column is used for
 * verification flows, not authentication lookup.
 *
 * Returns a typed result so callers can distinguish "no user" from
 * "ambiguous storage" — both are auth failures, but only the latter is
 * an operator-visible incident.
 */
export async function findUserByIdentifier(
  identifier: string,
): Promise<FindUserResult> {
  // Empty / whitespace-only input is NOT_FOUND without a DB round-trip.
  // Belt-and-braces: callers (login-check route + authorize()) already
  // reject empty strings, but this guards against a future caller
  // forgetting and silently returning the first row of an unscoped scan.
  const trimmed = identifier.trim();
  if (!trimmed) {
    return { ok: false, code: AUTH_LOOKUP_ERROR.NOT_FOUND };
  }

  // Auth-critical lookup: use withMetaDb so an expired token self-heals
  // rather than silently blocking login.
  //
  // We SELECT all matching rows (no LIMIT) and surface AMBIGUOUS when
  // >1 comes back. The DB unique index added in meta-migration 0003
  // makes that physically impossible for new data, but the typed-error
  // branch is the defence-in-depth requested by the issue spec.
  return withMetaDb(async (client) => {
    const result = await client.execute({
      sql: `SELECT id, email, username, password_hash, name
            FROM users
            WHERE username = ?`,
      args: [trimmed],
    });
    if (result.rows.length === 0) {
      return { ok: false, code: AUTH_LOOKUP_ERROR.NOT_FOUND };
    }
    if (result.rows.length > 1) {
      return { ok: false, code: AUTH_LOOKUP_ERROR.AMBIGUOUS };
    }
    const row = result.rows[0];
    return {
      ok: true,
      user: {
        id: row.id as string,
        email: (row.email as string) || null,
        username: row.username as string,
        passwordHash: row.password_hash as string,
        name: row.name as string | null,
      },
    };
  });
}

/**
 * @deprecated Use `findUserByIdentifier` (returns a typed result) instead.
 *
 * Retained as a thin shim during Wave 6b rollout so callers outside the
 * auth surface (e.g. ad-hoc scripts) don't break in the same PR. New
 * code MUST use `findUserByIdentifier`. This shim still resolves
 * username-only — the legacy email-OR-username behaviour is gone.
 */
export async function getUserByIdentifier(
  identifier: string,
): Promise<MetaUser | null> {
  const result = await findUserByIdentifier(identifier);
  return result.ok ? result.user : null;
}

export async function getFarmsForUser(userId: string): Promise<UserFarm[]> {
  const client = getMetaClient();
  const result = await client.execute({
    sql: `SELECT f.slug, f.display_name, fu.role, f.logo_url, f.tier, f.subscription_status
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
    subscriptionStatus: (row.subscription_status as string) ?? 'inactive',
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

export async function getAllFarmSlugs(): Promise<string[]> {
  const client = getMetaClient();
  const result = await client.execute({ sql: `SELECT slug FROM farms`, args: [] });
  return result.rows.map((row) => row.slug as string);
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

// ── Subscription helpers ────────────────────────────────────────────────────

export interface FarmBilling {
  tier: 'basic' | 'advanced';
  subscriptionStatus: 'active' | 'inactive' | null;
  billingFrequency: 'monthly' | 'annual' | null;
  lockedLsu: number | null;
  billingAmountZar: number | null;
  nextRenewalAt: string | null;
}

export interface SubscriptionFields {
  payfastToken?: string;
  startedAt?: string;
  billingDate?: string;
  tier?: 'basic' | 'advanced';
  billingFrequency?: 'monthly' | 'annual';
  lockedLsu?: number;
  billingAmountZar?: number;
  nextRenewalAt?: string;
}

export async function getFarmSubscription(farmSlug: string): Promise<{
  subscriptionStatus: string;
  payfastToken: string | null;
  subscriptionStartedAt: string | null;
} | null> {
  const client = getMetaClient();
  const result = await client.execute({
    sql: `SELECT subscription_status, payfast_token, subscription_started_at
          FROM farms WHERE slug = ? LIMIT 1`,
    args: [farmSlug],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    subscriptionStatus: (row.subscription_status as string) ?? 'inactive',
    payfastToken: (row.payfast_token as string) || null,
    subscriptionStartedAt: (row.subscription_started_at as string) || null,
  };
}

/**
 * Read the full billing view for a farm (tier + subscription + locked pricing).
 * Used by UpgradePrompt, /subscribe/upgrade, PayFast webhook.
 *
 * Returns null if the farm slug is not found.
 */
export async function getFarmBilling(farmSlug: string): Promise<FarmBilling | null> {
  const client = getMetaClient();
  const result = await client.execute({
    sql: `SELECT tier, subscription_status, billing_frequency, locked_lsu,
                 billing_amount_zar, next_renewal_at
          FROM farms WHERE slug = ? LIMIT 1`,
    args: [farmSlug],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    tier: (row.tier as 'basic' | 'advanced') ?? 'basic',
    subscriptionStatus:
      (row.subscription_status as FarmBilling['subscriptionStatus']) ?? null,
    billingFrequency:
      (row.billing_frequency as FarmBilling['billingFrequency']) ?? null,
    lockedLsu: row.locked_lsu != null ? Number(row.locked_lsu) : null,
    billingAmountZar:
      row.billing_amount_zar != null ? Number(row.billing_amount_zar) : null,
    nextRenewalAt: (row.next_renewal_at as string) ?? null,
  };
}

export async function updateFarmSubscription(
  farmSlug: string,
  status: string,
  opts: SubscriptionFields = {},
): Promise<void> {
  const client = getMetaClient();

  // Build SET clause dynamically so we only update fields that were provided.
  // Using COALESCE for the old fields would overwrite them with NULL when
  // opts is partial — we want "leave untouched" semantics instead.
  const sets: string[] = ['subscription_status = ?'];
  const args: (string | number | null)[] = [status];

  const push = (col: string, val: string | number | undefined) => {
    if (val === undefined) return;
    sets.push(`${col} = ?`);
    args.push(val);
  };

  push('payfast_token', opts.payfastToken);
  push('subscription_started_at', opts.startedAt);
  push('subscription_billing_date', opts.billingDate);
  push('tier', opts.tier);
  push('billing_frequency', opts.billingFrequency);
  push('locked_lsu', opts.lockedLsu);
  push('billing_amount_zar', opts.billingAmountZar);
  push('next_renewal_at', opts.nextRenewalAt);

  args.push(farmSlug);

  await client.execute({
    sql: `UPDATE farms SET ${sets.join(', ')} WHERE slug = ?`,
    args,
  });
}

export async function isEmailVerified(userId: string): Promise<boolean> {
  // Auth-critical: retry on token expiry so login isn't blocked by rotation.
  return withMetaDb(async (client) => {
    const result = await client.execute({
      sql: `SELECT email_verified FROM users WHERE id = ? LIMIT 1`,
      args: [userId],
    });
    if (result.rows.length === 0) return false;
    return (result.rows[0].email_verified as number) === 1;
  });
}

// ─── Consulting Leads (D4) ───────────────────────────────────────────

export type ConsultingLead = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  farmName: string | null;
  province: string | null;
  species: string[]; // parsed from species_json
  herdSize: number | null;
  dataNotes: string | null;
  customTracking: string | null;
  source: string;
  status: 'new' | 'scoped' | 'quoted' | 'active' | 'complete';
  assignedTo: string | null;
  createdAt: string; // ISO
};

export type ConsultingEngagement = {
  id: string;
  leadId: string;
  farmId: string | null;
  setupFeeZar: number | null;
  retainerFeeZar: number | null;
  startedAt: string | null;
  endsAt: string | null;
  status: string | null;
};

const ALLOWED_STATUS_TRANSITIONS: Record<
  ConsultingLead['status'],
  ConsultingLead['status'][]
> = {
  new: ['scoped'],
  scoped: ['quoted', 'new'],
  quoted: ['active', 'scoped'],
  active: ['complete', 'quoted'],
  complete: [],
};

const VALID_LEAD_STATUSES: ReadonlyArray<ConsultingLead['status']> = [
  'new',
  'scoped',
  'quoted',
  'active',
  'complete',
];

function parseSpeciesJson(raw: unknown): string[] {
  if (raw == null) return [];
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === 'string');
    }
    return [];
  } catch {
    return [];
  }
}

function rowToConsultingLead(row: Record<string, unknown>): ConsultingLead {
  return {
    id: row.id as string,
    name: row.name as string,
    email: row.email as string,
    phone: (row.phone as string) ?? null,
    farmName: (row.farm_name as string) ?? null,
    province: (row.province as string) ?? null,
    species: parseSpeciesJson(row.species_json),
    herdSize: row.herd_size != null ? Number(row.herd_size) : null,
    dataNotes: (row.data_notes as string) ?? null,
    customTracking: (row.custom_tracking as string) ?? null,
    source: row.source as string,
    status: (row.status as ConsultingLead['status']) ?? 'new',
    assignedTo: (row.assigned_to as string) ?? null,
    createdAt: row.created_at as string,
  };
}

export async function getConsultingLeads(opts?: {
  status?: ConsultingLead['status'];
  limit?: number;
}): Promise<ConsultingLead[]> {
  const client = getMetaClient();
  const limit = opts?.limit ?? 100;

  const sql = opts?.status
    ? `SELECT id, name, email, phone, farm_name, province, species_json, herd_size,
              data_notes, custom_tracking, source, status, assigned_to, created_at
         FROM consulting_leads
         WHERE status = ?
         ORDER BY created_at DESC
         LIMIT ?`
    : `SELECT id, name, email, phone, farm_name, province, species_json, herd_size,
              data_notes, custom_tracking, source, status, assigned_to, created_at
         FROM consulting_leads
         ORDER BY created_at DESC
         LIMIT ?`;
  const args: (string | number)[] = opts?.status
    ? [opts.status, limit]
    : [limit];

  const result = await client.execute({ sql, args });
  return result.rows.map((row) =>
    rowToConsultingLead(row as unknown as Record<string, unknown>),
  );
}

export async function getConsultingLeadById(
  id: string,
): Promise<ConsultingLead | null> {
  const client = getMetaClient();
  const result = await client.execute({
    sql: `SELECT id, name, email, phone, farm_name, province, species_json, herd_size,
                 data_notes, custom_tracking, source, status, assigned_to, created_at
          FROM consulting_leads
          WHERE id = ?
          LIMIT 1`,
    args: [id],
  });
  if (result.rows.length === 0) return null;
  return rowToConsultingLead(result.rows[0] as unknown as Record<string, unknown>);
}

export async function updateConsultingLeadStatus(
  id: string,
  nextStatus: ConsultingLead['status'],
  options?: { assignedTo?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = getMetaClient();

  const existing = await getConsultingLeadById(id);
  if (!existing) return { ok: false, error: 'not found' };

  const allowed = ALLOWED_STATUS_TRANSITIONS[existing.status] ?? [];
  if (!allowed.includes(nextStatus)) {
    return { ok: false, error: 'invalid transition' };
  }

  // Distinguish "caller passed no assignedTo" (undefined → preserve existing)
  // from "caller explicitly passed null" (un-assign). COALESCE conflates these.
  const hasAssignee = options !== undefined && 'assignedTo' in options;

  if (hasAssignee) {
    await client.execute({
      sql: `UPDATE consulting_leads SET status = ?, assigned_to = ? WHERE id = ?`,
      args: [nextStatus, options.assignedTo ?? null, id],
    });
  } else {
    await client.execute({
      sql: `UPDATE consulting_leads SET status = ? WHERE id = ?`,
      args: [nextStatus, id],
    });
  }

  return { ok: true };
}

export async function getConsultingEngagements(
  leadId?: string,
): Promise<ConsultingEngagement[]> {
  const client = getMetaClient();
  const sql = leadId
    ? `SELECT id, lead_id, farm_id, setup_fee_zar, retainer_fee_zar,
              started_at, ends_at, status
         FROM consulting_engagements
         WHERE lead_id = ?
         ORDER BY started_at DESC`
    : `SELECT id, lead_id, farm_id, setup_fee_zar, retainer_fee_zar,
              started_at, ends_at, status
         FROM consulting_engagements
         ORDER BY started_at DESC`;
  const args: string[] = leadId ? [leadId] : [];
  const result = await client.execute({ sql, args });
  return result.rows.map((row) => ({
    id: row.id as string,
    leadId: row.lead_id as string,
    farmId: (row.farm_id as string) ?? null,
    setupFeeZar: row.setup_fee_zar != null ? Number(row.setup_fee_zar) : null,
    retainerFeeZar:
      row.retainer_fee_zar != null ? Number(row.retainer_fee_zar) : null,
    startedAt: (row.started_at as string) ?? null,
    endsAt: (row.ends_at as string) ?? null,
    status: (row.status as string) ?? null,
  }));
}

/**
 * A platform admin can manage the consulting CRM across all farms.
 *
 * Source of truth: PLATFORM_ADMIN_EMAILS env var (comma-separated).
 * If unset, falls back to "any farm-level ADMIN" (legacy behaviour, not
 * recommended for production — logs a warning once).
 */
export async function isPlatformAdmin(email: string): Promise<boolean> {
  const allowlist = process.env.PLATFORM_ADMIN_EMAILS;
  if (allowlist) {
    const emails = allowlist
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    return emails.includes(email.toLowerCase());
  }

  // Fallback — legacy farm-ADMIN check. Log once per process.
  if (!hasWarnedAboutPlatformAdminFallback) {
    hasWarnedAboutPlatformAdminFallback = true;
    logger.warn(
      '[meta-db] PLATFORM_ADMIN_EMAILS not set — falling back to farm-ADMIN check. Set the env var for production.',
    );
  }
  const client = getMetaClient();
  const result = await client.execute({
    sql: `
      SELECT COUNT(*) as count
      FROM farm_users fu
      JOIN users u ON u.id = fu.user_id
      WHERE u.email = ? AND fu.role = 'ADMIN'
    `,
    args: [email],
  });
  const count = Number(result.rows[0]?.count ?? 0);
  return count > 0;
}

export { ALLOWED_STATUS_TRANSITIONS, VALID_LEAD_STATUSES };

// ─── Branch DB Clones (Option C — issue #19) ────────────────────────────────

export interface BranchCloneRecord {
  branchName: string;
  tursoDbName: string;
  tursoDbUrl: string;
  tursoAuthToken: string;
  sourceDbName: string;
  createdAt: string;
  lastPromotedAt: string | null;
  prodMigrationAt: string | null;
}

function rowToBranchCloneRecord(row: Record<string, unknown>): BranchCloneRecord {
  return {
    branchName: row.branch_name as string,
    tursoDbName: row.turso_db_name as string,
    tursoDbUrl: row.turso_db_url as string,
    tursoAuthToken: row.turso_auth_token as string,
    sourceDbName: row.source_db_name as string,
    createdAt: row.created_at as string,
    lastPromotedAt: (row.last_promoted_at as string) ?? null,
    prodMigrationAt: (row.prod_migration_at as string) ?? null,
  };
}

/**
 * Insert or replace a branch DB clone record.
 * `created_at` is always set to now (INSERT OR REPLACE resets all columns).
 */
export async function recordBranchClone(input: {
  branchName: string;
  tursoDbName: string;
  tursoDbUrl: string;
  tursoAuthToken: string;
  sourceDbName: string;
}): Promise<void> {
  const client = getMetaClient();
  await client.execute({
    sql: `INSERT OR REPLACE INTO branch_db_clones
            (branch_name, turso_db_name, turso_db_url, turso_auth_token,
             source_db_name, created_at, last_promoted_at, prod_migration_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
    args: [
      input.branchName,
      input.tursoDbName,
      input.tursoDbUrl,
      input.tursoAuthToken,
      input.sourceDbName,
      new Date().toISOString(),
    ],
  });
}

/**
 * Fetch a single branch clone record by branch name.
 * Returns null if not found.
 */
export async function getBranchClone(
  branchName: string,
): Promise<BranchCloneRecord | null> {
  const client = getMetaClient();
  const result = await client.execute({
    sql: `SELECT branch_name, turso_db_name, turso_db_url, turso_auth_token,
                 source_db_name, created_at, last_promoted_at, prod_migration_at
          FROM branch_db_clones
          WHERE branch_name = ?
          LIMIT 1`,
    args: [branchName],
  });
  if (result.rows.length === 0) return null;
  return rowToBranchCloneRecord(result.rows[0] as unknown as Record<string, unknown>);
}

/**
 * Return all branch clone records ordered by created_at DESC.
 */
export async function listBranchClones(): Promise<BranchCloneRecord[]> {
  const client = getMetaClient();
  const result = await client.execute({
    sql: `SELECT branch_name, turso_db_name, turso_db_url, turso_auth_token,
                 source_db_name, created_at, last_promoted_at, prod_migration_at
          FROM branch_db_clones
          ORDER BY created_at DESC`,
    args: [],
  });
  return result.rows.map((row) =>
    rowToBranchCloneRecord(row as unknown as Record<string, unknown>),
  );
}

/**
 * Mark a branch clone as promoted to prod.
 * Sets last_promoted_at to now and prod_migration_at to the provided ISO string.
 * No-op if the branch does not exist.
 */
export async function markBranchClonePromoted(
  branchName: string,
  prodMigrationAt: string,
): Promise<void> {
  const client = getMetaClient();
  await client.execute({
    sql: `UPDATE branch_db_clones
          SET last_promoted_at = ?, prod_migration_at = ?
          WHERE branch_name = ?`,
    args: [new Date().toISOString(), prodMigrationAt, branchName],
  });
}

/**
 * Delete a branch clone record. Idempotent — no error if branch not found.
 */
export async function deleteBranchClone(branchName: string): Promise<void> {
  const client = getMetaClient();
  await client.execute({
    sql: `DELETE FROM branch_db_clones WHERE branch_name = ?`,
    args: [branchName],
  });
}
