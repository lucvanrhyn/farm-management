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
  subscriptionStatus: string;
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
  const client = getMetaClient();
  const result = await client.execute({
    sql: `SELECT email_verified FROM users WHERE id = ? LIMIT 1`,
    args: [userId],
  });
  if (result.rows.length === 0) return false;
  return (result.rows[0].email_verified as number) === 1;
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

  // COALESCE(?, assigned_to) → keeps existing when null/undefined is passed.
  const assignedArg =
    options?.assignedTo === undefined ? null : options.assignedTo;

  await client.execute({
    sql: `UPDATE consulting_leads
          SET status = ?, assigned_to = COALESCE(?, assigned_to)
          WHERE id = ?`,
    args: [nextStatus, assignedArg, id],
  });

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
 * A user is a "platform admin" if they hold ADMIN role on ANY farm in the
 * meta-DB. Used to gate meta-level consulting CRM operations.
 */
export async function isPlatformAdmin(email: string): Promise<boolean> {
  const client = getMetaClient();
  const result = await client.execute({
    sql: `SELECT 1
          FROM farm_users fu
          JOIN users u ON u.id = fu.user_id
          WHERE u.email = ? AND fu.role = 'ADMIN'
          LIMIT 1`,
    args: [email],
  });
  return result.rows.length > 0;
}

export { ALLOWED_STATUS_TRANSITIONS, VALID_LEAD_STATUSES };
