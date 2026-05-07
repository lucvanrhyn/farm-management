/**
 * Wave A — `tenantWrite` transport adapter.
 *
 * Same contract as `adminWrite` minus the role/fresh-admin gate. Used by
 * routes that any authenticated farm user (LOGGER / VIEWER / ADMIN) may
 * invoke — observations, photo uploads, animal POST (calf creation by
 * LOGGER), notifications mark-read, etc.
 *
 * The adapter still owns:
 *   - `getFarmContext(req)` resolution → 401 AUTH_REQUIRED on null.
 *   - Body parse → 400 INVALID_BODY on missing/non-JSON; 400
 *     VALIDATION_FAILED on schema throw.
 *   - Try/catch around `handle` → mapApiDomainError first, fall back to
 *     500 DB_QUERY_FAILED.
 *   - Revalidate-tag fired ONLY on 2xx.
 *   - `withServerTiming` instrumentation.
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
  TenantWriteOpts,
} from "./types";
import { RouteValidationError } from "./types";

function extractDetails(err: unknown): Record<string, unknown> | undefined {
  if (err instanceof RouteValidationError) return err.details;
  if (err && typeof err === "object" && "issues" in err) {
    const issues = (err as { issues?: unknown }).issues;
    if (Array.isArray(issues)) return { issues };
  }
  return undefined;
}

/**
 * Parse JSON body. Empty/missing body is allowed and surfaces as `{}` so
 * DELETE handlers (which typically carry no body) are not rejected. A
 * non-empty payload that fails JSON parsing returns INVALID_BODY. See
 * `admin-write.ts` for the same contract.
 */
async function parseBody(
  req: NextRequest,
): Promise<{ ok: true; body: unknown } | { ok: false; res: NextResponse }> {
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return {
      ok: false,
      res: routeError("INVALID_BODY", "Could not read request body", 400),
    };
  }
  if (raw.length === 0) return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return {
      ok: false,
      res: routeError("INVALID_BODY", "Request body must be valid JSON", 400),
    };
  }
}

export function tenantWrite<
  TBody = unknown,
  TParams extends RouteParams = RouteParams,
>(opts: TenantWriteOpts<TBody, TParams>): RouteHandler<TParams> {
  return async (req: NextRequest, ctx?: RouteContext<TParams>) => {
    return withServerTiming(async () => {
      const farmCtx = await timeAsync("session", () => getFarmContext(req));
      if (!farmCtx) {
        return routeError("AUTH_REQUIRED", "Unauthorized", 401);
      }

      const parsed = await parseBody(req);
      if (!parsed.ok) return parsed.res;

      let body: TBody;
      try {
        body = opts.schema
          ? opts.schema.parse(parsed.body)
          : (parsed.body as TBody);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Validation failed";
        return routeError("VALIDATION_FAILED", message, 400, extractDetails(err));
      }

      const params: TParams = ctx?.params ? await ctx.params : ({} as TParams);

      let response: NextResponse;
      try {
        response = await opts.handle(farmCtx, body, req, params);
      } catch (err) {
        const mapped = mapApiDomainError(err);
        if (mapped) return mapped as NextResponse;
        const message = err instanceof Error ? err.message : String(err);
        logger.error("[route] tenantWrite handler threw", { error: err });
        return routeError("DB_QUERY_FAILED", message, 500);
      }

      if (response.status >= 200 && response.status < 300) {
        const hooks = Array.isArray(opts.revalidate)
          ? opts.revalidate
          : opts.revalidate
          ? [opts.revalidate]
          : [];
        for (const hook of hooks) {
          try {
            hook(farmCtx.slug);
          } catch (err) {
            logger.error("[route] revalidate hook threw", { error: err });
          }
        }
      }

      return response;
    });
  };
}
