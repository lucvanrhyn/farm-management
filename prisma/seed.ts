import { PrismaClient } from "@prisma/client";
import { hashSync } from "bcryptjs";

const prisma = new PrismaClient();

const users = [
  {
    email: "admin@example.com",
    password: "changeme_admin",
    name: "Luc",
    role: "admin",
  },
  {
    email: "field@example.com",
    password: "changeme_field",
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
  console.log("Seeding users...");
  for (const user of users) {
    const hashed = hashSync(user.password, 12);
    await prisma.user.upsert({
      where: { email: user.email },
      update: { password: hashed, name: user.name, role: user.role },
      create: { email: user.email, password: hashed, name: user.name, role: user.role },
    });
    console.log(`  ✓ ${user.name} (${user.email})`);
  }
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
