import { randomUUID } from 'crypto';
import { createTursoDatabase, deleteTursoDatabase } from './turso-api';
import { seedFarmDatabase } from './seed-farm-db';
import { generateSlug } from './slug';
import {
  createUser,
  createFarm,
  createFarmUser,
  setVerificationToken,
} from './meta-db';
import { generateVerificationToken, sendVerificationEmail } from './email-verification';

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
 * If any step fails after DB creation, attempts cleanup (delete Turso DB).
 */
export async function provisionFarm(input: ProvisionFarmInput): Promise<ProvisionFarmResult> {
  const { name, email, username, passwordHash, farmName } = input;
  const tier = 'basic';

  const slug = await generateSlug(farmName);
  const dbName = `ft-${slug}`;

  // Step 1: Create Turso database
  const { url, token } = await createTursoDatabase(dbName);

  try {
    // Step 2: Seed FarmSettings
    await seedFarmDatabase(url, token, farmName);

    // Step 3: Insert user into meta-db
    const userId = randomUUID();
    await createUser(userId, email, username, passwordHash, name);

    // Step 4: Insert farm into meta-db
    const farmId = randomUUID();
    await createFarm(farmId, slug, farmName, url, token, tier);

    // Step 5: Link user to farm as ADMIN
    await createFarmUser(userId, farmId, 'ADMIN');

    // Step 6: Email verification
    const { token: verifyToken, expiresAt } = generateVerificationToken();
    await setVerificationToken(userId, verifyToken, expiresAt);
    await sendVerificationEmail(email, verifyToken);

    return { slug, userId };
  } catch (error) {
    // Cleanup: attempt to delete the Turso DB if provisioning fails after creation
    try {
      await deleteTursoDatabase(dbName);
    } catch {
      console.error(`[provisioning] Failed to cleanup Turso DB '${dbName}' after error`);
    }
    throw error;
  }
}
