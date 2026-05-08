/**
 * Wave G1 (#165) — domain ops `voidNvd` + `voidNvdById`.
 *
 * `voidNvd(prisma, id, reason)` is the low-level update — preserved
 * verbatim from `lib/server/nvd.ts::voidNvd` for legacy callers (e.g.
 * exporters, tests, admin scripts).
 *
 * `voidNvdById(prisma, id, reason)` is the business-rule wrapper used by
 * the route adapter: it enforces the existence + not-already-voided
 * pre-conditions and throws typed errors. The wave plan calls for
 * `voidNvd` to migrate, but the route handler also owned the existence /
 * already-voided checks — moving those into the domain layer means the
 * route compresses to a single `voidNvdById(...)` call.
 */
import type { PrismaClient } from "@prisma/client";

import { NvdAlreadyVoidedError, NvdNotFoundError } from "./errors";

/**
 * Marks an NvdRecord as voided. Does NOT delete — the record is retained
 * for audit trail. Pre-condition: the record exists and is not already
 * voided. The adapter wrapper (`voidNvdById`) enforces those.
 */
export async function voidNvd(
  prisma: PrismaClient,
  id: string,
  reason: string,
): Promise<void> {
  await prisma.nvdRecord.update({
    where: { id },
    data: {
      voidedAt: new Date(),
      voidReason: reason,
    },
  });
}

/**
 * Existence + already-voided pre-checks plus the void update.
 *
 * Throws:
 *   - `NvdNotFoundError` (404) when the record is not found.
 *   - `NvdAlreadyVoidedError` (409) when `voidedAt` is non-null.
 */
export async function voidNvdById(
  prisma: PrismaClient,
  id: string,
  reason: string,
): Promise<{ ok: true }> {
  const record = await prisma.nvdRecord.findUnique({
    where: { id },
    select: { id: true, voidedAt: true },
  });
  if (!record) {
    throw new NvdNotFoundError(id);
  }
  if (record.voidedAt) {
    throw new NvdAlreadyVoidedError(id);
  }
  await voidNvd(prisma, id, reason);
  return { ok: true };
}
