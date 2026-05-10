/**
 * lib/sw/telemetry-bypass.ts
 *
 * Pure URL predicate used by the Serwist `/api/*` matcher to identify
 * telemetry endpoints that MUST NOT be intercepted by the service worker.
 *
 * Background — production triage P2.2 (wave/182, 2026-05-10)
 * ──────────────────────────────────────────────────────────
 * `/api/telemetry/vitals` POSTs were failing with `ERR_ABORTED` on every
 * page navigation in production, so LCP/FID/CLS/INP telemetry was being
 * silently dropped.
 *
 * Root cause: the SW's catch-all `/api/*` matcher used `NetworkOnly`,
 * which calls `event.respondWith(fetch(event.request))` from inside the
 * SW. When the page unloads (which is exactly when web-vitals fires its
 * final-state callbacks), the browser still routes the page-side
 * `sendBeacon` / `fetch({ keepalive: true })` calls through the
 * controlling SW's fetch handler. The fetch executed inside the SW does
 * NOT inherit `keepalive` semantics, and the SW's response promise gets
 * aborted as the page tears down — even though the page-side caller
 * specifically chose APIs designed to survive unload.
 *
 * Fix: telemetry endpoints must bypass the SW entirely. By making the
 * `/api/*` matcher return false for these URLs, no Serwist route matches,
 * `handleFetch` (Serwist.ts:472) returns undefined without calling
 * `event.respondWith`, and the request goes to the network natively —
 * fully respecting `sendBeacon` / `keepalive: true` semantics.
 *
 * The same risk applies to `/api/telemetry/client-errors` (also a beacon
 * endpoint via lib/client-logger.ts) and any future telemetry routes, so
 * the predicate matches the entire `/api/telemetry/` prefix.
 *
 * Pure & framework-free so it can be unit-tested without booting a
 * service worker.
 */

const TELEMETRY_PREFIX = "/api/telemetry/";

/**
 * Returns true if the given URL pathname is a telemetry endpoint that
 * should bypass the service worker.
 */
export function isTelemetryRequest(pathname: string): boolean {
  return pathname.startsWith(TELEMETRY_PREFIX);
}
