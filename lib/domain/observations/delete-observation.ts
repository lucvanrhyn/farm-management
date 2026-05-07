/**
 * Wave C (#156) — domain op `deleteObservation`.
 *
 * Removes an observation row by id. Throws `ObservationNotFoundError`
 * when the row does not exist so the adapter envelope can mint a 404.
 */
import type { PrismaClient } from "@prisma/client";

import { ObservationNotFoundError } from "./errors";

export interface DeleteObservationResult {
  success: true;
}

export async function deleteObservation(
  prisma: PrismaClient,
  id: string,
): Promise<DeleteObservationResult> {
  const existing = await prisma.observation.findUnique({ where: { id } });
  if (!existing) {
    throw new ObservationNotFoundError(id);
  }

  await prisma.observation.delete({ where: { id } });

  return { success: true };
}
