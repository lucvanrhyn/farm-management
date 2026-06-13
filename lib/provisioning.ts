import { randomUUID } from 'crypto';
import { createTursoDatabase, deleteTursoDatabase } from './turso-api';
import { seedFarmDatabase } from './seed-farm-db';
import { generateSlug } from './slug';
import {
  createUser,
  createFarm,
  createFarmUser,
  setVerificationToken,
  deleteFarmUser,
  deleteFarm,
  deleteUser,
} from './meta-db';
import { generateVerificationToken, sendVerificationEmail } from './email-verification';
import { logger } from './logger';

export interface ProvisionFarmInput {
  name: string;
  email: string;
  username: string;
  passwordHash: string;
  farmName: string;
}

export interface ProvisionFarmResult {
  slug: string;
  userId: string;
}

/**
 * Full onboarding pipeline for self-service registration.
 * Always creates a basic-tier farm. Steps:
 *
 * 1. Generate slug from farm name
 * 2. Create child Turso database from schema parent
 * 3. Seed FarmSettings row on new DB
 * 4. Insert user into meta-db
 * 5. Insert farm into meta-db
 * 6. Insert farm_users mapping (role: ADMIN)
 * 7. Generate + send email verification
 *
 * Provisioning is NOT a single transaction — the Turso tenant DB and the three
 * meta rows are written in separate awaits against two different systems. When
 * a step fails, the catch performs best-effort compensating deletes in REVERSE
 * creation order (farm_users mapping → farm → user → Turso DB), each wrapped so
 * one rollback failure can't abort the others. This prevents the H6/OB-007
 * orphan class: previously the catch deleted ONLY the Turso DB, leaving meta
 * rows (user/farm/mapping) pointing at a now-deleted database — a tenant the
 * registrant could never log into. Each created resource is tracked so we never
 * attempt to delete something that was never written.
 */
export async function provisionFarm(input: ProvisionFarmInput): Promise<ProvisionFarmResult> {
  const { name, email, username, passwordHash, farmName } = input;
  const tier = 'basic';

  const slug = await generateSlug(farmName);
  const dbName = `ft-${slug}`;

  // Step 1: Create Turso database
  const { url, token } = await createTursoDatabase(dbName);

  // Track which compensable resources actually got created so the rollback
  // only undoes real writes (avoids no-op deletes against rows that the
  // failing step never reached).
  let createdUserId: string | null = null;
  let createdFarmId: string | null = null;
  let createdFarmUser: { userId: string; farmId: string } | null = null;

  try {
    // Step 2: Seed FarmSettings
    await seedFarmDatabase(url, token, farmName);

    // Step 3: Insert user into meta-db
    const userId = randomUUID();
    await createUser(userId, email, username, passwordHash, name);
    createdUserId = userId;

    // Step 4: Insert farm into meta-db
    const farmId = randomUUID();
    await createFarm(farmId, slug, farmName, url, token, tier);
    createdFarmId = farmId;

    // Step 5: Link user to farm as ADMIN
    await createFarmUser(userId, farmId, 'ADMIN');
    createdFarmUser = { userId, farmId };

    // Step 6: Email verification
    const { token: verifyToken, expiresAt } = generateVerificationToken();
    await setVerificationToken(userId, verifyToken, expiresAt);
    await sendVerificationEmail(email, verifyToken);

    return { slug, userId };
  } catch (error) {
    // Compensating rollback, REVERSE creation order. Each delete is isolated:
    // a failure in one is logged (never silently swallowed) and does not stop
    // the others, so a flaky meta delete can't strand the Turso DB or vice
    // versa. The original `error` is always rethrown so the caller's response
    // is unchanged.
    await safeCleanup('delete farm_users mapping', { dbName }, async () => {
      if (createdFarmUser) {
        await deleteFarmUser(createdFarmUser.userId, createdFarmUser.farmId);
      }
    });
    await safeCleanup('delete farm row', { dbName, farmId: createdFarmId }, async () => {
      if (createdFarmId) await deleteFarm(createdFarmId);
    });
    await safeCleanup('delete user row', { dbName, userId: createdUserId }, async () => {
      if (createdUserId) await deleteUser(createdUserId);
    });
    await safeCleanup('delete Turso DB', { dbName }, async () => {
      await deleteTursoDatabase(dbName);
    });

    throw error;
  }
}

/**
 * Run one compensating-delete step in isolation. Any failure is logged with
 * context (never silently swallowed) and absorbed so the remaining rollback
 * steps still execute. Returns nothing — the caller rethrows the original
 * provisioning error regardless.
 */
async function safeCleanup(
  step: string,
  ctx: Record<string, unknown>,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (cleanupError) {
    const message =
      cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    logger.error(`[provisioning] Rollback step failed: ${step}`, { ...ctx, message });
  }
}
