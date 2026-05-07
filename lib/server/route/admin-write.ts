/**
 * Wave A — `adminWrite` transport adapter.
 *
 * Wraps a write handler with:
 *   1. `getFarmContext(req)` resolution → 401 AUTH_REQUIRED on null.
 *   2. Hard role gate `role === "ADMIN"` → 403 FORBIDDEN otherwise.
 *   3. Stale-ADMIN re-verify against meta-db via `verifyFreshAdminRole`
 *      (ADR-0001 §"Invariants" + Phase H.2 contract). 403 FORBIDDEN on
 *      stale-ADMIN.
 *   4. Body parse: `await req.json()`. Missing/non-JSON → 400 INVALID_BODY.
 *      When `schema` is provided, schema.parse runs; throw → 400
 *      VALIDATION_FAILED with details if it's a `RouteValidationError` or
 *      a zod-compatible error with `.issues`.
 *   5. Try/catch around `handle`: `mapApiDomainError` first, fallback
 *      to 500 DB_QUERY_FAILED with the underlying message.
 *   6. Revalidate-tag fired ONLY when `handle` returns a 2xx.
 *   7. `withServerTiming` instrumentation (`session` + `total` spans).
 *
 * Usage:
 *   export const POST = adminWrite<{ campId: string; campName: string }>({
 *     schema: { parse: (x) => x as ... },
 *     revalidate: revalidateCampWrite,
 *     handle: async (ctx, body, req, params) => { ... },
 *   });
 */
import type { NextRequest, NextResponse } from "next/server";

import { getFarmContext } from "@/lib/server/farm-context";
import { verifyFreshAdminRole } from "@/lib/auth";
import { mapApiDomainError } from "@/lib/server/api-errors";
import { withServerTiming, timeAsync } from "@/lib/server/server-timing";
import { logger } from "@/lib/logger";

import { routeError } from "./envelope";
import type {
  AdminWriteOpts,
  RouteContext,
  RouteHandler,
  RouteParams,
} from "./types";
import { RouteValidationError } from "./types";

/** Best-effort extraction of zod-compatible field-error details. */
function extractDetails(err: unknown): Record<string, unknown> | undefined {
  if (err instanceof RouteValidationError) return err.details;
  // zod-compatible: ZodError carries `.issues`. Normalise to a details bag
  // without taking a runtime dependency on zod.
  if (err && typeof err === "object" && "issues" in err) {
    const issues = (err as { issues?: unknown }).issues;
    if (Array.isArray(issues)) return { issues };
  }
  return undefined;
}

/**
 * Parse JSON body. Empty/missing body is allowed and surfaces as `{}` so
 * DELETE handlers (which typically carry no body) are not rejected. A
 * non-empty payload that fails JSON parsing returns INVALID_BODY.
 *
 * Multipart / form-data / non-JSON content types skip the JSON parse
 * altogether — the inner handler reads `req.formData()` (or similar)
 * directly. The handler receives `undefined` as the parsed body in
 * that case; routes with a `schema` should not be used with multipart
 * payloads (use a hand-rolled parse inside the handler instead).
 *
 * The schema layer (when present) is responsible for asserting required
 * fields — a `{}` body that violates the schema yields VALIDATION_FAILED,
 * not INVALID_BODY.
 */
async function parseBody(
  req: NextRequest,
): Promise<{ ok: true; body: unknown } | { ok: false; res: NextResponse }> {
  const contentType = req.headers.get("content-type") ?? "";
  if (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
    // Non-JSON request body: hand-roll-parse inside the handler. We do not
    // consume the body here so `req.formData()` later still has bytes.
    return { ok: true, body: undefined };
  }

  // `req.text()` returns "" when the request has no body. Try-parse from
  // the text representation so we can distinguish empty from malformed.
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

export function adminWrite<
  TBody = unknown,
  TParams extends RouteParams = RouteParams,
>(opts: AdminWriteOpts<TBody, TParams>): RouteHandler<TParams> {
  return async (req: NextRequest, ctx: RouteContext<TParams>) => {
    return withServerTiming(async () => {
      const farmCtx = await timeAsync("session", () => getFarmContext(req));
      if (!farmCtx) {
        return routeError("AUTH_REQUIRED", "Unauthorized", 401);
      }
      if (farmCtx.role !== "ADMIN") {
        return routeError("FORBIDDEN", "Forbidden", 403);
      }
      const fresh = await verifyFreshAdminRole(
        farmCtx.session.user.id,
        farmCtx.slug,
      );
      if (!fresh) {
        return routeError("FORBIDDEN", "Forbidden", 403);
      }

      // Body parse — only attempted when the route is a method that carries a
      // body. Next.js' NextRequest exposes `body` for POST/PATCH/PUT/DELETE
      // alike, so we always parse and fall through to INVALID_BODY when the
      // payload is absent.
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

      let response: Response;
      try {
        response = await opts.handle(farmCtx, body, req, params);
      } catch (err) {
        const mapped = mapApiDomainError(err);
        if (mapped) return mapped;
        const message = err instanceof Error ? err.message : String(err);
        logger.error("[route] adminWrite handler threw", { error: err });
        return routeError("DB_QUERY_FAILED", message, 500);
      }

      // Revalidate ONLY on 2xx — auth/validation/business 4xx + 5xx must not
      // trigger cache invalidation.
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
            // Cache invalidation must never break the user-visible response.
            logger.error("[route] revalidate hook threw", { error: err });
          }
        }
      }

      return response;
    });
  };
}
