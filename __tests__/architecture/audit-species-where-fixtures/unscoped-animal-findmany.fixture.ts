// Fixture for audit-species-where unit tests. NOT real source code.
// Demonstrates the violating shape: a per-species `prisma.animal.findMany`
// call that forgets the species axis and would silently return rows from
// every species on the tenant DB.
//
// The audit script must flag this file when run as a vitest fixture, but
// it is path-prefixed `__tests__/architecture/audit-species-where-fixtures/`
// which is on the audit's skip-list so it never blocks CI.
import { prisma } from "@/lib/prisma";

export async function leaky() {
  return prisma.animal.findMany({
    where: { status: "Active" },
    orderBy: { animalId: "asc" },
  });
}
