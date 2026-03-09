import { PrismaClient } from "@prisma/client";
import { hashSync } from "bcryptjs";

const prisma = new PrismaClient();

const users = [
  {
    email: "luc@triob.co.za",
    password: "Tr!oB_Adm1n_26",
    name: "Luc",
    role: "admin",
  },
  {
    email: "dicky@triob.co.za",
    password: "Tr!oB_F13ld_26",
    name: "Dicky",
    role: "field_logger",
  },
  {
    email: "oupa@triob.co.za",
    password: "triob2024",
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
