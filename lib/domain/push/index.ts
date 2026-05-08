/**
 * Wave F (#163) — public surface of the push domain ops.
 *
 * Each op is a pure function on `(prisma, userEmail, ...)` that returns
 * `{ success: true }` and throws typed errors for invalid payloads. The
 * transport adapters (`tenantWrite`) wire these into the
 * `app/api/push/subscribe` route handler; typed errors map onto the wire
 * envelope via `mapApiDomainError`.
 *
 * See `docs/adr/0001-route-handler-architecture.md` and
 * `tasks/wave-163-comms-surfaces.md`.
 */
export {
  subscribePush,
  type SubscribePushInput,
} from "./subscribe-push";
export { unsubscribePush } from "./unsubscribe-push";
export {
  InvalidSubscriptionError,
  MissingEndpointError,
  INVALID_SUBSCRIPTION,
  MISSING_ENDPOINT,
} from "./errors";
