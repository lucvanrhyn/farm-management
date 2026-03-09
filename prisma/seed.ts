import { createClient } from "@libsql/client";
import { hashSync } from "bcryptjs";

const users = [
  {
    email: "admin@example.com",
    password: "SCRUBBED-PASSWORD",
    name: "Luc",
    role: "admin",
  },
  {
    email: "field@example.com",
    password: "SCRUBBED-PASSWORD",
    name: "Dicky",
    role: "field_logger",
  },
  {
    email: "viewer@example.com",
    password: "SCRUBBED-PASSWORD",
    name: "Oupa",
    role: "viewer",
  },
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
