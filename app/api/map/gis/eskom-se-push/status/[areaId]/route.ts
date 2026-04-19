/**
 * Phase K — Wave 2C — External GIS proxy: EskomSePush area load-shedding status.
 *
 * GET /api/map/gis/eskom-se-push/status/[areaId]
 *   → raw EskomSePush area payload (next slots, events, schedule).
 *
 * Upstream: https://developer.sepush.co.za/business/2.0/area?id=<areaId>
 * Auth: header `token: ${ESKOMSEPUSH_TOKEN}` (lazy-read inside handler).
 *
 * Caching: 1 hour per areaId. Next.js `revalidate` handles the key derivation
 * because the URL segment varies per areaId.
 *
 * Policy on upstream failure / missing token:
 *   Return HTTP 200 with `{ _stale: true, _error }`.
 *
 * Error codes (in `_error`):
 *   NO_TOKEN           — ESKOMSEPUSH_TOKEN env var missing
 *   MISSING_AREA_ID    — path param empty
 *   INVALID_AREA_ID    — path param doesn't look like an EskomSePush area id
 *   UPSTREAM_TIMEOUT   — fetch aborted after 10s
 *   UPSTREAM_ERROR     — non-2xx from EskomSePush
 *   UPSTREAM_PARSE     — non-JSON response
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 3_600; // 1 hour

// EskomSePush area IDs look like `eskde-10-witbankmp` or `capetown-1-...`.
// Keep the allow-list loose (letters/digits/hyphens, 3..80 chars) and let the
// upstream reject truly bad IDs.
const AREA_ID_RE = /^[a-zA-Z0-9-]{3,80}$/;

function stale(code: string) {
  return NextResponse.json({ _stale: true, _error: code }, { status: 200 });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ areaId: string }> },
) {
  const { areaId } = await params;

  if (!areaId) return stale("MISSING_AREA_ID");
  if (!AREA_ID_RE.test(areaId)) return stale("INVALID_AREA_ID");

  // Lazy env read — never at module scope.
  const token = process.env.ESKOMSEPUSH_TOKEN;
  if (!token) return stale("NO_TOKEN");

  const upstream = `https://developer.sepush.co.za/business/2.0/area?id=${encodeURIComponent(areaId)}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    let res: Response;
    try {
      res = await fetch(upstream, {
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
