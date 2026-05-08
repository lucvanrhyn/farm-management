/**
 * Wave G1 (#165) — `tenantWriteSlug` transport adapter.
 *
 * Slug-aware variant of `tenantWrite`. Same contract — auth, body parse,
 * schema validation, mapApiDomainError-on-throw, revalidate-on-2xx,
 * withServerTiming — but the auth/tenant context comes from
 * `getFarmContextForSlug(slug, req)` instead of `getFarmContext(req)`.
 *
 * Used by every authenticated `[farmSlug]/**` write route that any farm
 * role (LOGGER / VIEWER / ADMIN) may invoke (e.g. `/api/[farmSlug]/nvd/validate`
 * — read-only validation that still needs auth + tenant scoping).
 */
import type { NextRequest, NextResponse } from "next/server";

import { mapApiDomainError } from "@/lib/server/api-errors";
import { withServerTiming } from "@/lib/server/server-timing";
import { logger } from "@/lib/logger";

import { routeError } from "./envelope";
import { resolveSlugContext } from "./_resolve-slug";
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
 * Parse JSON body. See `tenant-write.ts` for the full contract — multipart
 * skipped, empty body is `{}`, malformed JSON returns INVALID_BODY.
 */
async function parseBody(
  req: NextRequest,
): Promise<{ ok: true; body: unknown } | { ok: false; res: NextResponse }> {
  const contentType = req.headers.get("content-type") ?? "";
  if (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
    return { ok: true, body: undefined };
  }
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

export function tenantWriteSlug<
  TBody = unknown,
  TParams extends RouteParams & { farmSlug: string } = RouteParams & {
    farmSlug: string;
  },
>(opts: TenantWriteOpts<TBody, TParams>): RouteHandler<TParams> {
  return async (req: NextRequest, ctx: RouteContext<TParams>) => {
    return withServerTiming(async () => {
      const { farmCtx, params } = await resolveSlugContext<TParams>(req, ctx);
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
        const message =
          err instanceof Error ? err.message : "Validation failed";
        return routeError(
          "VALIDATION_FAILED",
          message,
          400,
          extractDetails(err),
        );
      }

      let response: Response;
      try {
        response = await opts.handle(farmCtx, body, req, params);
      } catch (err) {
        const mapped = mapApiDomainError(err);
        if (mapped) return mapped;
        const message = err instanceof Error ? err.message : String(err);
        logger.error("[route] tenantWriteSlug handler threw", { error: err });
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
