/**
 * Phase K — Wave 2C — External GIS proxy: EskomSePush allowances.
 *
 * GET /api/map/gis/eskom-se-push/allowances
 *   → raw EskomSePush allowances payload (remaining API calls in month).
 *
 * Upstream: https://developer.sepush.co.za/business/2.0/api_allowance
 * Auth: header `token: ${ESKOMSEPUSH_TOKEN}` (lazy-read inside handler — never
 *       at module scope, per the Resend module-load-time gotcha in MEMORY.md).
 *
 * Caching: 1 hour (allowances change every API call; polling tighter is waste).
 *
 * Policy on upstream failure / missing token:
 *   Return HTTP 200 with `{ _stale: true, _error }` so the UI never sees a 500.
 *
 * Auth (app-level): flows through proxy.ts (authenticated session required).
 * Deliberate: prevents anonymous visitors burning our API quota.
 *
 * Error codes (in `_error`):
 *   NO_TOKEN           — ESKOMSEPUSH_TOKEN env var missing
 *   UPSTREAM_TIMEOUT   — fetch aborted after 10s
 *   UPSTREAM_ERROR     — non-2xx from EskomSePush
 *   UPSTREAM_PARSE     — non-JSON response
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 3_600; // 1 hour

const UPSTREAM = "https://developer.sepush.co.za/business/2.0/api_allowance";

function stale(code: string) {
  return NextResponse.json({ _stale: true, _error: code }, { status: 200 });
}

export async function GET(_req: NextRequest) {
  // Lazy env read — never at module scope (MEMORY.md "Module-load-time SDK gotcha").
  const token = process.env.ESKOMSEPUSH_TOKEN;
  if (!token) return stale("NO_TOKEN");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    let res: Response;
    try {
      res = await fetch(UPSTREAM, {
        signal: controller.signal,
        next: { revalidate: 3_600 },
        headers: { token, Accept: "application/json" },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) return stale("UPSTREAM_ERROR");

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return stale("UPSTREAM_PARSE");
    }

    return NextResponse.json(data);
  } catch (err) {
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" || err.message.includes("aborted"));
    return stale(isAbort ? "UPSTREAM_TIMEOUT" : "UPSTREAM_ERROR");
  }
}
