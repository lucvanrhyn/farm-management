/**
 * Wave G1 (#165) — internal slug-context resolver helper.
 *
 * Shared by `tenantReadSlug`, `tenantWriteSlug`, and `adminWriteSlug`.
 * The body of each slug-aware adapter is otherwise identical to its
 * subdomain sibling — only the auth/tenant-context resolution swaps from
 * `getFarmContext(req)` to `getFarmContextForSlug(farmSlug, req)`.
 *
 * Keeping this in one private module lets the slug variants stay ~10
 * lines each ("resolve via slug, delegate to shared body") and means
 * future changes to the slug resolution path land in one file.
 *
 * NOT exported from `index.ts` — internal contract only.
 */
import type { NextRequest } from "next/server";

import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
import type { FarmContext } from "@/lib/server/farm-context";
import { timeAsync } from "@/lib/server/server-timing";

import type { RouteContext, RouteParams } from "./types";

/**
 * Awaits `ctx.params`, reads `farmSlug`, and resolves the per-request
 * `FarmContext` via `getFarmContextForSlug`. Returns the `params` bag too
 * so callers don't re-await the same promise.
 *
 * The `session` server-timing span wraps the resolver so the slug variant
 * surfaces the same `session;dur=…` budget as the subdomain adapter — ops
 * dashboards keying on that span name keep working.
 */
export async function resolveSlugContext<
  TParams extends RouteParams & { farmSlug: string },
>(
  req: NextRequest,
  ctx: RouteContext<TParams>,
): Promise<{ farmCtx: FarmContext | null; params: TParams }> {
  // Defensive empty-params fallback mirrors the subdomain adapters —
  // routes always carry `farmSlug` in their params so the cast is safe in
  // practice, but tests sometimes invoke with `Promise.resolve({})`.
  const params: TParams = ctx?.params ? await ctx.params : ({} as TParams);
  const farmSlug = params.farmSlug;
  if (typeof farmSlug !== "string" || farmSlug.length === 0) {
    return { farmCtx: null, params };
  }
  const farmCtx = await timeAsync("session", () =>
    getFarmContextForSlug(farmSlug, req),
  );
  return { farmCtx, params };
}
