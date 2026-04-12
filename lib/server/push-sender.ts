import webpush from "web-push";
import type { PrismaClient } from "@prisma/client";

let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:support@farmtrack.app";
  if (!publicKey || !privateKey) {
    throw new Error("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  href: string;
}

/**
 * Sends a push notification to all subscriptions stored in the farm DB.
 * Removes expired/invalid subscriptions automatically.
 */
export async function sendPushToFarm(
  prisma: PrismaClient,
  payload: PushPayload,
): Promise<void> {
  ensureVapid();

  const subscriptions = await prisma.pushSubscription.findMany();
  if (subscriptions.length === 0) return;

  const data = JSON.stringify(payload);
  const staleEndpoints: string[] = [];

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          data,
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 410 Gone or 404 Not Found = subscription is no longer valid
        if (status === 410 || status === 404) {
          staleEndpoints.push(sub.endpoint);
        }
      }
    }),
  );

  if (staleEndpoints.length > 0) {
    await prisma.pushSubscription.deleteMany({
      where: { endpoint: { in: staleEndpoints } },
    });
  }
}
