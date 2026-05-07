/**
 * Wave A — types for the route-handler transport adapters.
 *
 * The adapters (`tenantRead`, `adminWrite`, `tenantWrite`, `publicHandler`)
 * own the HTTP shape — auth, role gates, body parse, typed-error envelope,
 * revalidate-tag, server-timing — so that route files compress to one
 * wiring expression. See `docs/adr/0001-route-handler-architecture.md` for
 * the full architectural rationale.
 *
 * This module exposes only types; the runtime helpers live in sibling
 * modules. Importing this file should never pull in next-auth, prisma, or
 * any heavyweight runtime — it must stay safe to import from tests and
 * static analysers.
 */
import type { NextRequest, NextResponse } from "next/server";
import type { FarmContext } from "@/lib/server/farm-context";

/**
 * Canonical SCREAMING_SNAKE error code emitted in the typed-error envelope.
 * Keeping this as a `string` (rather than a closed union) lets adapters
 * forward the code emitted by `mapApiDomainError` (e.g. `CROSS_SPECIES_BLOCKED`)
 * without forcing a union maintenance burden across this contract.
 */
export type RouteErrorCode = string;

/**
 * The on-the-wire envelope for any error emitted by an adapter. `error`
 * is required and machine-readable; `message` is required for human display
 * via the adapters (always populated on canonical errors); `details` carries
 * optional structured field-level info (e.g. validation failure metadata).
 */
export interface RouteErrorBody {
  error: RouteErrorCode;
  message?: string;
  details?: Record<string, unknown>;
}

/**
 * Resolved route params. Next.js 16 awaits the params promise in the
 * adapter, so the inner `handle` callback receives a plain object, not a
 * promise.
 */
export type RouteParams = Record<string, string>;

/**
 * Next.js 16 route-handler signature. The framework supplies a context
 * with a `params` promise that the adapter awaits before calling the
 * inner `handle`.
 */
export interface RouteContext<TParams extends RouteParams = RouteParams> {
  readonly params: Promise<TParams>;
}

/**
 * The wrapped function returned by every adapter. Same shape as a vanilla
 * Next.js route handler — drop-in compatible with `export const GET = ...`.
 *
 * `ctx` is optional at the type level because legacy unit tests invoke the
 * route handler with a single argument (no `params` promise). The adapter
 * defaults `params` to `{}` when `ctx` is omitted, matching the framework
 * runtime contract for routes without dynamic segments.
 *
 * Return type is `Response | NextResponse` so streaming handlers (e.g.
 * SSE-driven import progress) can return a plain `Response` whose body is
 * a `ReadableStream` while the typical handler returns `NextResponse`.
 */
export type RouteHandler<TParams extends RouteParams = RouteParams> = (
  req: NextRequest,
  ctx?: RouteContext<TParams>,
) => Promise<Response>;

/**
 * Body-validation contract — duck-compatible with `zod`'s `ZodType<T>` so
 * we can plug a real zod schema in once the dep lands without changing
 * any adapter signatures. For now, callers pass any object with a
 * `parse(input): T` method.
 *
 * On validation failure the schema MUST throw. Adapters catch the throw,
 * extract `.issues` (zod) or `.details` (custom) when present, and emit
 * the typed-error envelope under `VALIDATION_FAILED`.
 */
export interface RouteBodySchema<T> {
  parse(input: unknown): T;
}

/**
 * Error thrown from a `RouteBodySchema.parse` to surface field-level
 * validation details into the envelope's `details` field. Callers that
 * use a raw zod schema get the same effect via `ZodError.issues`.
 */
export class RouteValidationError extends Error {
  readonly details?: Record<string, unknown>;
  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "RouteValidationError";
    this.details = details;
  }
}

/**
 * The inner work of an `tenantRead` adapter. Receives the resolved
 * `FarmContext` (auth + tenant-scoped Prisma) and produces a `Response`.
 */
export type TenantReadHandle<TParams extends RouteParams = RouteParams> = (
  ctx: FarmContext,
  req: NextRequest,
  params: TParams,
) => Promise<Response>;

/**
 * The inner work of a write adapter (`adminWrite` / `tenantWrite`). The
 * body has already been parsed against `schema` and validated.
 */
export type WriteHandle<
  TBody,
  TParams extends RouteParams = RouteParams,
> = (
  ctx: FarmContext,
  body: TBody,
  req: NextRequest,
  params: TParams,
) => Promise<Response>;

/**
 * The inner work of a `publicHandler` adapter. No auth, no body parse —
 * the adapter only owns envelope-on-throw.
 */
export type PublicHandle<TParams extends RouteParams = RouteParams> = (
  req: NextRequest,
  params: TParams,
) => Promise<Response>;

/**
 * Revalidation hook accepted by the write adapters. Wave A keeps this a
 * simple `(slug: string) => void` callback so the existing
 * `revalidate*Write(slug)` helpers from `lib/server/revalidate.ts` plug in
 * directly. Wave B+ may tighten this to a typed key tree.
 */
export type RevalidateHook = (slug: string) => void;

/** Options accepted by `tenantRead`. */
export interface TenantReadOpts<TParams extends RouteParams = RouteParams> {
  readonly handle: TenantReadHandle<TParams>;
}

/** Options accepted by `adminWrite`. */
export interface AdminWriteOpts<
  TBody = unknown,
  TParams extends RouteParams = RouteParams,
> {
  readonly schema?: RouteBodySchema<TBody>;
  readonly revalidate?: RevalidateHook | RevalidateHook[];
  readonly handle: WriteHandle<TBody, TParams>;
}

/** Options accepted by `tenantWrite`. Same shape as `adminWrite` minus
 * the role/fresh-admin gate (enforced by adapter, not the option). */
export type TenantWriteOpts<
  TBody = unknown,
  TParams extends RouteParams = RouteParams,
> = AdminWriteOpts<TBody, TParams>;

/** Options accepted by `publicHandler`. */
export interface PublicHandlerOpts<TParams extends RouteParams = RouteParams> {
  readonly handle: PublicHandle<TParams>;
}
