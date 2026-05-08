/**
 * Wave F (#163) — public surface of the notifications domain ops.
 *
 * Each op is a pure function that returns plain JSON-serialisable data.
 * The transport adapters (`tenantRead`, `tenantWrite`) wire these into the
 * `app/api/notifications/**` route handlers; there are no typed errors at
 * this layer (notifications has only adapter-emitted 401/403).
 *
 * See `docs/adr/0001-route-handler-architecture.md` and
 * `tasks/wave-163-comms-surfaces.md`.
 */
export {
  listNotifications,
  type ListNotificationsResult,
} from "./list-notifications";
export { markNotificationRead } from "./mark-notification-read";
export { markAllNotificationsRead } from "./mark-all-notifications-read";
