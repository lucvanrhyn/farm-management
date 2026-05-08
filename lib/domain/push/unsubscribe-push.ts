/**
 * Wave F (#163) — domain op `unsubscribePush`.
 *
 * Pre-Wave-F home: `app/api/push/subscribe/route.ts` DELETE. Removes the
 * `PushSubscription` row identified by `endpoint`, scoped by `userEmail`
 * so no caller can unsubscribe another user's device. Uses `deleteMany`
 * so the call is idempotent — missing row is a silent no-op.
 *
 * Throws `MissingEndpointError` on empty `endpoint` — the route adapter
 * maps this to 400 via `mapApiDomainError`.
 */
import type { PrismaClient } from "@prisma/client";

import { MissingEndpointError } from "./errors";

export async function unsubscribePush(
  prisma: PrismaClient,
  userEmail: string,
  endpoint: string,
): Promise<{ success: true }> {
  if (!endpoint) {
    throw new MissingEndpointError();
  }

  await prisma.pushSubscription.deleteMany({
    where: { endpoint, userEmail },
  });

  return { success: true };
}
