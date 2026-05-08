/**
 * Wave F (#163) — domain op `listNotifications`.
 *
 * Pre-Wave-F home: `app/api/notifications/route.ts` GET. The op is a typed
 * wrapper over `getCachedNotifications(slug, userEmail)` so the route layer
 * imports a domain surface (consistent with Waves A→E) rather than reaching
 * directly into the cache helper.
 *
 * Wire shape (`{ notifications, unreadCount }`) is preserved verbatim from
 * `CachedNotificationsPayload` — the NotificationBell + admin UI compare
 * against this exact shape.
 *
 * No business-rule errors — adapter handles 401/403, cache miss returns
 * `{ notifications: [], unreadCount: 0 }` which is a valid empty payload.
 */
import {
  getCachedNotifications,
  type CachedNotificationsPayload,
} from "@/lib/server/cached";

export type ListNotificationsResult = CachedNotificationsPayload;

export async function listNotifications(
  slug: string,
  userEmail: string,
): Promise<ListNotificationsResult> {
  return getCachedNotifications(slug, userEmail);
}
