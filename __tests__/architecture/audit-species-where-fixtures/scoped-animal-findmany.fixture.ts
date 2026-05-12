// Fixture for audit-species-where unit tests. NOT real source code.
// Demonstrates the compliant shape: a call routed through `scoped(prisma, mode)`,
// which by construction injects the species axis. The audit script must NOT
// flag this file — the `prisma.<model>` regex doesn't match the chained
// receiver `scoped(...).animal`.
import { prisma } from "@/lib/prisma";
import { scoped } from "@/lib/server/species-scoped-prisma";
import type { SpeciesId } from "@/lib/species/types";

export async function tidy(mode: SpeciesId) {
  return scoped(prisma, mode).animal.findMany({
    orderBy: { animalId: "asc" },
  });
}
