/**
 * Wave A — `tenantRead` transport adapter.
 *
 * Wraps a read-only handler with:
 *   - one-shot `getFarmContext(req)` resolution (auth + tenant-scoped Prisma)
 *   - typed-error envelope on auth failure (`AUTH_REQUIRED`)
 *   - try/catch around `handle`, with `mapApiDomainError` first-priority,
 *     falling back to `{ error: "DB_QUERY_FAILED", message: <err.message> }`
 *   - `withServerTiming` instrumentation (`session` + `total` spans by default;
 *     callers may add their own `query` spans inside `handle` via `timeAsync`)
 *
 * Usage:
 *   export const GET = tenantRead<{ campId: string }>({
 *     handle: async (ctx, req, params) => {
 *       const camp = await ctx.prisma.camp.findUnique({ where: { campId: params.campId } });
 *       return NextResponse.json(camp);
 *     },
 *   });
 */
import type { NextRequest, NextResponse } from "next/server";

import { getFarmContext } from "@/lib/server/farm-context";
import { mapApiDomainError } from "@/lib/server/api-errors";
import { withServerTiming, timeAsync } from "@/lib/server/server-timing";
import { logger } from "@/lib/logger";

import { routeError } from "./envelope";
import type {
  RouteContext,
  RouteHandler,
  RouteParams,
  TenantReadOpts,
} from "./types";

export function tenantRead<TParams extends RouteParams = RouteParams>(
  opts: TenantReadOpts<TParams>,
): RouteHandler<TParams> {
  return async (req: NextRequest, ctx?: RouteContext<TParams>) => {
    return withServerTiming(async () => {
      const farmCtx = await timeAsync("session", () => getFarmContext(req));
      if (!farmCtx) {
        return routeError("AUTH_REQUIRED", "Unauthorized", 401);
      }

      // Next.js 16 awaits the params promise inside the adapter so the inner
      // handler receives a plain object — no awaits leak into the domain
      // layer once Wave B+ extracts.
      const params: TParams = ctx?.params
        ? await ctx.params
        : ({} as TParams);

      try {
        return await opts.handle(farmCtx, req, params);
      } catch (err) {
        const mapped = mapApiDomainError(err);
        if (mapped) return mapped as NextResponse;
        const message = err instanceof Error ? err.message : String(err);
        logger.error("[route] tenantRead handler threw", { error: err });
        return routeError("DB_QUERY_FAILED", message, 500);
      }
    });
  };
}
