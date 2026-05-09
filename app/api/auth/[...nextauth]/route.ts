import type { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { publicHandler } from "@/lib/server/route";

// NextAuth v4's catch-all returns `any` from its single-arg overload
// (`declare function NextAuth(options: AuthOptions): any`), so the resulting
// handler accepts any `(req, ctx)` shape. publicHandler awaits `ctx.params`
// for us; we re-wrap as `Promise.resolve(params)` to match NextAuth's
// expected `RouteHandlerContext` shape (`{ params: Awaitable<{ nextauth: string[] }> }`).
//
// publicHandler's `RouteParams` constraint is `Record<string, string>`
// (string-valued params). Next.js 16's auto-generated route validator for
// catch-all segments requires `params: Promise<{ nextauth: string[] }>`
// (array-valued). The two are runtime-compatible — publicHandler is a pure
// pass-through — but the validator-generated type check rejects the structural
// mismatch on the export site. Widening `RouteParams` repo-wide to admit
// array values is out of scope for H4 (touches every adapter signature).
//
// The fix: keep `publicHandler({...})` as the export expression (so the
// route-handler-coverage architectural invariant holds) and apply a typed
// `as` cast to the Next 16 catch-all handler shape. No `any`; the cast is
// to a precise typed function signature that the framework expects.
const nextAuthHandler = NextAuth(authOptions);

type CatchAllRouteHandler = (
  req: NextRequest,
  ctx: { params: Promise<{ nextauth: string[] }> },
) => Promise<Response>;

export const GET = publicHandler({
  handle: async (req, params) => {
    return nextAuthHandler(req, { params: Promise.resolve(params) });
  },
}) as unknown as CatchAllRouteHandler;

export const POST = publicHandler({
  handle: async (req, params) => {
    return nextAuthHandler(req, { params: Promise.resolve(params) });
  },
}) as unknown as CatchAllRouteHandler;
