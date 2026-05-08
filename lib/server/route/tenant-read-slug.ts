/**
 * Wave G1 (#165) — `tenantReadSlug` transport adapter.
 *
 * Slug-aware variant of `tenantRead`. Same contract — auth check,
 * mapApiDomainError-on-throw, DB_QUERY_FAILED fallback, withServerTiming
 * — but the auth/tenant context comes from `getFarmContextForSlug(slug, req)`
 * instead of `getFarmContext(req)`.
 *
 * Used by every `app/api/[farmSlug]/**\/route.ts` GET handler in Waves G1-G5.
 *
 * Usage:
 *   export const GET = tenantReadSlug<{ farmSlug: string; id: string }>({
 *     handle: async (ctx, req, params) => {
 *       const record = await getNvdById(ctx.prisma, params.id);
 *       return NextResponse.json(record);
 *     },
 *   });
 *
 * PDF route note: `handle` may return any `Response` (including a binary
 * `application/pdf` body). The adapter never wraps the success response —
 * only error paths mint JSON envelopes.
 */
import type { NextRequest } from "next/server";

import { mapApiDomainError } from "@/lib/server/api-errors";
import { withServerTiming } from "@/lib/server/server-timing";
import { logger } from "@/lib/logger";

import { routeError } from "./envelope";
import { resolveSlugContext } from "./_resolve-slug";
import type {
  RouteContext,
  RouteHandler,
  RouteParams,
  TenantReadOpts,
} from "./types";

export function tenantReadSlug<
  TParams extends RouteParams & { farmSlug: string },
>(opts: TenantReadOpts<TParams>): RouteHandler<TParams> {
  return async (req: NextRequest, ctx: RouteContext<TParams>) => {
    return withServerTiming(async () => {
      const { farmCtx, params } = await resolveSlugContext<TParams>(req, ctx);
      if (!farmCtx) {
        return routeError("AUTH_REQUIRED", "Unauthorized", 401);
      }

      try {
        return await opts.handle(farmCtx, req, params);
      } catch (err) {
        const mapped = mapApiDomainError(err);
        if (mapped) return mapped;
        const message = err instanceof Error ? err.message : String(err);
        logger.error("[route] tenantReadSlug handler threw", { error: err });
        return routeError("DB_QUERY_FAILED", message, 500);
      }
    });
  };
}
