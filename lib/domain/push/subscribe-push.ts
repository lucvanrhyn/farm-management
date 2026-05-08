/**
 * Wave F (#163) — domain op `subscribePush`.
 *
 * Pre-Wave-F home: `app/api/push/subscribe/route.ts` POST. Upserts a
 * `PushSubscription` row keyed by the canonical `endpoint` URL, binding
 * it to the caller's `userEmail` so a subsequent unsubscribe (scoped by
 * userEmail) only removes the caller's own subscription.
 *
 * Throws `InvalidSubscriptionError` on missing endpoint / keys — the route
 * adapter maps this to 400 via `mapApiDomainError`.
 */
import type { PrismaClient } from "@prisma/client";

import { InvalidSubscriptionError } from "./errors";

export interface SubscribePushInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function subscribePush(
  prisma: PrismaClient,
  userEmail: string,
  input: SubscribePushInput,
): Promise<{ success: true }> {
  if (
    !input.endpoint ||
    !input.keys?.p256dh ||
    !input.keys?.auth
  ) {
    throw new InvalidSubscriptionError();
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userEmail,
    },
    update: {
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userEmail,
    },
  });

  return { success: true };
}
