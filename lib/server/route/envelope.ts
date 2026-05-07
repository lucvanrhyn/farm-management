/**
 * Wave A — typed-error envelope minter.
 *
 * Every adapter (`tenantRead`, `adminWrite`, `tenantWrite`, `publicHandler`)
 * routes its error path through `routeError(code, message?, status?, details?)`.
 * No adapter is permitted to call `NextResponse.json({ error: ... }, ...)`
 * directly — that's how wire-format drift sneaks in.
 *
 * The envelope shape is `{ error: CODE, message?: string,
 * details?: Record<string, unknown> }` per ADR-0001. `error` is always a
 * SCREAMING_SNAKE machine-readable code; `message` is the human-readable
 * one-liner the UI should display; `details` carries optional structured
 * field-level info (e.g. zod issues).
 */
import { NextResponse } from "next/server";

import type { RouteErrorBody, RouteErrorCode } from "./types";

/**
 * Default HTTP status for canonical SCREAMING_SNAKE codes. An unknown code
 * falls back to 500 unless an explicit `status` argument is passed.
 */
const DEFAULT_STATUS: Readonly<Record<string, number>> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  CROSS_TENANT_FORBIDDEN: 403,
  INVALID_BODY: 400,
  VALIDATION_FAILED: 400,
  DB_QUERY_FAILED: 500,
};

/**
 * Mint a typed-error envelope response.
 *
 * - `code` — SCREAMING_SNAKE machine-readable error code.
 * - `message` — human-readable one-liner. Optional for unclassified
 *   error paths where there is nothing safe to display, but every
 *   canonical adapter error supplies one.
 * - `status` — explicit HTTP status. When omitted, the status is
 *   inferred from `DEFAULT_STATUS[code]` (falling back to 500 for
 *   unknown codes).
 * - `details` — optional structured payload (e.g. validation field
 *   errors).
 */
export function routeError(
  code: RouteErrorCode,
  message?: string,
  status?: number,
  details?: Record<string, unknown>,
): NextResponse {
  const body: RouteErrorBody = { error: code };
  if (message !== undefined) body.message = message;
  if (details !== undefined) body.details = details;
  const resolvedStatus = status ?? DEFAULT_STATUS[code] ?? 500;
  return NextResponse.json(body, { status: resolvedStatus });
}
