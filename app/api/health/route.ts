/**
 * GET /api/health — uptime / liveness probe (Phase C, bug C1)
 *
 * Returns a tiny JSON document:
 *
 *   { "status": "ok", "timestamp": "<ISO-8601>", "version": "<git sha?>" }
 *
 * Why this file exists
 * ────────────────────
 * Before this route, hitting /api/health rendered the Next app shell
 * (200 text/html). Uptime monitors / load balancers configured to require
 * `application/json` were happy with 200, so a real outage that still served
 * the SPA shell would not page anyone — a silent-failure class bug.
 *
 * Contract
 * ────────
 * - 200 OK on every successful invocation. The route does NOT consult the
 *   database, NextAuth, or any external service. A "deep" health check that
 *   reaches into Turso / Inngest belongs at /api/health/deep — and would
 *   intentionally be allowed to fail to surface backend incidents. This
 *   shallow probe verifies only that the Next runtime itself is alive.
 * - `Cache-Control: no-store` so monitors never serve a stale cached OK
 *   from a CDN edge after a cold-start failure.
 * - The route is excluded from the proxy.ts matcher (see
 *   __tests__/api/proxy-matcher.test.ts → KNOWN_PUBLIC_ROUTES) so external
 *   monitors authenticate-less and cannot 307 to /login.
 *
 * The `version` field is the Vercel commit SHA (`VERCEL_GIT_COMMIT_SHA`)
 * when present. Useful for confirming a deploy is the one you think it is.
 * Omitted in environments that do not expose it (local dev) so the response
 * shape stays minimal.
 *
 * Wave H1 (#173) — wrapped in `publicHandler` adapter for ADR-0001 8/8.
 * Adapter only adds try/catch around handle; wire-shape preserved verbatim.
 */

import { NextResponse } from "next/server";
import { publicHandler } from "@/lib/server/route";

// Force the dynamic Node runtime so each invocation produces a fresh
// timestamp. Without this Next can statically render the route at build
// time and serve the same `timestamp` for the entire deploy lifetime.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = publicHandler({
  handle: async () => {
    const body: { status: "ok"; timestamp: string; version?: string } = {
      status: "ok",
      timestamp: new Date().toISOString(),
    };

    const sha = process.env.VERCEL_GIT_COMMIT_SHA;
    if (sha) {
      body.version = sha;
    }

    return NextResponse.json(body, {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  },
});
