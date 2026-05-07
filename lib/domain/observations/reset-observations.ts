/**
 * Wave C (#156) — domain op `resetObservations`.
 *
 * Bulk-deletes every observation row for the calling tenant. The route
 * adapter (`adminWrite`) gates this on a fresh-ADMIN check; the op
 * itself is dependency-free against the Prisma scope handed in.
 *
 * Returns the deleted-row count for telemetry.
 */
import type { PrismaClient } from "@prisma/client";

export interface ResetObservationsResult {
  success: true;
  count: number;
}

export async function resetObservations(
  prisma: PrismaClient,
): Promise<ResetObservationsResult> {
  const { count } = await prisma.observation.deleteMany({});
  return { success: true, count };
}
