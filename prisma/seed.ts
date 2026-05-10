import { createClient } from "@libsql/client";
import { hashSync } from "bcryptjs";

// Seed users come from env vars so plaintext passwords never live in source.
// Required: SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD/SEED_ADMIN_NAME (and the same
// trio for FIELD_ and VIEWER_). The script throws below if any are missing.
type SeedUser = { email: string; password: string; name: string; role: string };

function readSeedUser(prefix: string, role: string): SeedUser {
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  const name = process.env[`${prefix}_NAME`];
  if (!email || !password || !name) {
    throw new Error(
      `Missing seed env vars: set ${prefix}_EMAIL, ${prefix}_PASSWORD, ${prefix}_NAME`,
    );
  }
  return { email, password, name, role };
}

const users: SeedUser[] = [
  readSeedUser("SEED_ADMIN", "admin"),
  readSeedUser("SEED_FIELD", "field_logger"),
  readSeedUser("SEED_VIEWER", "viewer"),
];

async function main() {
  if (process.env.TURSO_DATABASE_URL) {
    // Production: use libsql client directly (Prisma adapter rejects raw queries via HTTP)
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    console.log("Seeding users (Turso)...");
    for (const user of users) {
      const hashed = hashSync(user.password, 12);
      await client.execute({
        sql: `INSERT INTO "User" (id, email, name, password, role, createdAt)
              VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, datetime('now'))
              ON CONFLICT(email) DO UPDATE SET
                password = excluded.password,
                name     = excluded.name,
                role     = excluded.role`,
        args: [user.email, user.name, hashed, user.role],
      });
      console.log(`  ✓ ${user.name} (${user.email})`);
    }

    await client.close();
  } else {
    // Local: use Prisma with local SQLite
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();

    console.log("Seeding users (local SQLite)...");
    for (const user of users) {
      const hashed = hashSync(user.password, 12);
      await prisma.user.upsert({
        where: { email: user.email },
        update: { password: hashed, name: user.name, role: user.role },
        create: { email: user.email, password: hashed, name: user.name, role: user.role },
      });
      console.log(`  ✓ ${user.name} (${user.email})`);
    }

    await prisma.$disconnect();
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
