/**
 * Wave A — `publicHandler` transport adapter.
 *
 * For the 14 routes outside the proxy.ts matcher (webhooks, telemetry
 * beacon, auth catch-all, the `/api/farms/[slug]/select` shortcircuit).
 * No auth, no body parse — the adapter only owns:
 *   - try/catch around `handle` → mapApiDomainError first; fall back to
 *     a 500 DB_QUERY_FAILED envelope with NO message (#483 — the raw error
 *     never reaches the client; it is logged server-side).
 *   - `withServerTiming` instrumentation.
 *
 * Auth-style handlers (e.g. NextAuth catch-all) supply their own
 * authentication inside `handle`. The adapter intentionally adds no
 * authentication seam so it does not collide with framework-managed
 * auth flows.
 */
import type { NextRequest } from "next/server";

import { mapApiDomainError } from "@/lib/server/api-errors";
import { withServerTiming } from "@/lib/server/server-timing";
import { logger } from "@/lib/logger";

import { routeError } from "./envelope";
import type {
  PublicHandlerOpts,
  RouteContext,
  RouteHandler,
  RouteParams,
} from "./types";

export function publicHandler<TParams extends RouteParams = RouteParams>(
  opts: PublicHandlerOpts<TParams>,
): RouteHandler<TParams> {
  return async (req: NextRequest, ctx: RouteContext<TParams>) => {
    return withServerTiming(async () => {
      const params: TParams = ctx?.params ? await ctx.params : ({} as TParams);
      try {
        return await opts.handle(req, params);
      } catch (err) {
        const mapped = mapApiDomainError(err);
        if (mapped) return mapped;
        // #483 — never echo a raw err.message to the client; the full error
        // is preserved in the server log below.
        logger.error("[route] publicHandler handler threw", { error: err });
        return routeError("DB_QUERY_FAILED", undefined, 500);
      }
    });
  };
}
