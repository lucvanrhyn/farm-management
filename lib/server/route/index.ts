/**
 * Wave A — public surface of the route-handler transport adapters.
 *
 * Re-exports the four named adapters and the typed-error envelope so
 * route files import everything from one path.
 *
 * Usage:
 *   import { tenantRead, adminWrite, tenantWrite, publicHandler, routeError }
 *     from "@/lib/server/route";
 *
 * See `docs/adr/0001-route-handler-architecture.md` for the architectural
 * decision and `tasks/wave-a-route-handler-adapters.md` for the wave plan.
 */
export { tenantRead } from "./tenant-read";
export { adminWrite } from "./admin-write";
export { tenantWrite } from "./tenant-write";
export { publicHandler } from "./public-handler";
// Wave G1 (#165) — slug-aware variants for `[farmSlug]/**` routes.
export { tenantReadSlug } from "./tenant-read-slug";
export { tenantWriteSlug } from "./tenant-write-slug";
export { adminWriteSlug } from "./admin-write-slug";
export { routeError } from "./envelope";
export {
  RouteValidationError,
  type AdminWriteOpts,
  type PublicHandle,
  type PublicHandlerOpts,
  type RevalidateHook,
  type RouteBodySchema,
  type RouteContext,
  type RouteErrorBody,
  type RouteErrorCode,
  type RouteHandler,
  type RouteParams,
  type TenantReadHandle,
  type TenantReadOpts,
  type TenantWriteOpts,
  type WriteHandle,
} from "./types";
