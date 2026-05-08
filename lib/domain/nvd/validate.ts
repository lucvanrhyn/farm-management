/**
 * Wave G1 (#165) — domain op `validateNvdAnimals`.
 *
 * Read-only check that none of the requested animals are inside an active
 * withdrawal period. Used both as a stand-alone POST endpoint
 * (`/[farmSlug]/nvd/validate`) and as the first step inside `issueNvd`.
 *
 * Returns a discriminated union — the route adapter forwards it to the
 * caller as JSON. No errors are thrown for the "ok:false" case; the
 * blocker list is the data, not an exception (the form needs to display
 * the blockers without unwinding the request).
 */
import type { PrismaClient } from "@prisma/client";

import { getAnimalsInWithdrawal } from "@/lib/server/treatment-analytics";

import type { ValidationResult } from "./snapshot";

export async function validateNvdAnimals(
  prisma: PrismaClient,
  animalIds: string[],
): Promise<ValidationResult> {
  const inWithdrawal = await getAnimalsInWithdrawal(prisma);
  const blockers = inWithdrawal.filter((a) => animalIds.includes(a.animalId));
  if (blockers.length === 0) return { ok: true };
  return { ok: false, blockers };
}
