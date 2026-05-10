# wave/182 — telemetry vitals POST aborted on page navigation

**Production triage:** P2.2
**Status:** patched, awaiting verification
**Branch:** `wave/182-telemetry-vitals-abort`

## Symptom (as reported)

Every page navigation in production produced an `ERR_ABORTED` entry in
the browser Network panel for `POST /api/telemetry/vitals`. Effect:
LCP / FID / CLS / INP / FCP / TTFB telemetry was being silently dropped,
so the `vitals_events` meta table was no longer growing and the perf
dashboard had stopped receiving fresh samples.

## Investigation

The dispatch brief predicted the cause was a vanilla `fetch` without
`keepalive: true`. That was already ruled out — `components/ReportWebVitals.tsx`
already does the textbook-correct thing:

1. `navigator.sendBeacon(url, blob)` first (designed for unload).
2. Falls back to `fetch(url, { method: "POST", keepalive: true, ... })`.

The route handler `app/api/telemetry/vitals/route.ts` is also healthy —
`publicHandler`, fast `req.json()`, returns 202.

So **why** were the requests aborting?

### Root cause: Service Worker interception

`app/sw.ts` (Serwist) shipped a single matcher for `/api/*`:

```ts
{ matcher: /\/api\//i, handler: new NetworkOnly() }
```

`NetworkOnly` calls `event.respondWith(fetch(event.request))` from
**inside** the SW. When a page is unloading:

* The page-side `sendBeacon` / `fetch({ keepalive: true })` call still
  goes through the controlling SW's `fetch` event handler. Both APIs
  are fully visible to controlled pages — `sendBeacon` does NOT bypass
  SW fetch listeners (per spec).
* The `fetch` call executed inside the SW does **not** carry `keepalive`
  semantics through to the underlying network request.
* As the page tears down, the SW's outstanding response promise gets
  aborted by the browser → `event.respondWith` rejects → the page
  records `ERR_ABORTED` for the original request.

This precisely matches "ERR_ABORTED on every page navigation" because
web-vitals fires its final metric callbacks during `pagehide` /
`visibilitychange`, which is exactly the unload window where the SW
context is dying.

The same risk applies to `/api/telemetry/client-errors`
(beacon-style endpoint via `lib/client-logger.ts`).

### Why "skip via fetch listener" doesn't work

The naive instinct is to `self.addEventListener("fetch", ...)` before
Serwist registers, and early-return for telemetry URLs. That **does
not** prevent Serwist from claiming the request: only the first listener
that calls `event.respondWith` wins, and Serwist's listener still calls
it once any of its routes matches. The fix has to be at the route-match
layer.

### How Serwist actually short-circuits

`node_modules/serwist/src/Serwist.ts` `handleFetch` (line 472):

```ts
handleFetch(event: FetchEvent) {
  const responsePromise = this.handleRequest({ request, event });
  if (responsePromise) {
    event.respondWith(responsePromise);
  }
}
```

`handleRequest` returns `undefined` when no route matches AND no default
handler is set (line 795-802). When `responsePromise` is undefined,
`respondWith` is never called → the browser delivers the request to the
network natively, fully respecting `sendBeacon` / `keepalive: true`.

So the fix is to make our `/api/*` matcher return false for telemetry
URLs. No match → no `respondWith` → no SW interference.

## Fix

1. New module `lib/sw/telemetry-bypass.ts` exporting the pure predicate
   `isTelemetryRequest(pathname: string): boolean` that matches
   `/api/telemetry/<endpoint>` (any segment after the prefix). Pure +
   framework-free so it is unit-testable without a SW.
2. `app/sw.ts` — replaced the regex matcher with a function matcher
   that consults the predicate:

   ```ts
   {
     matcher: ({ url, sameOrigin }) =>
       sameOrigin && url.pathname.startsWith("/api/") && !isTelemetryRequest(url.pathname),
     handler: new NetworkOnly(),
   }
   ```

3. New test `__tests__/sw/telemetry-bypass.test.ts` (7 cases) locks the
   predicate down so a future "tidy the regex" PR can't silently
   re-introduce the abort bug. Covers happy-path telemetry URLs, every
   non-telemetry `/api/*` route currently in the app, and substring
   false-positive defenses.

### Why this matcher is also safe under defaultCache

`@serwist/next/worker`'s `defaultCache` only matches `/api/*` for GET
requests (line 192 of `index.worker.ts`). Telemetry is POST-only, so it
will not match any `defaultCache` entry. Telemetry POSTs fall through
all routes → `handleRequest` returns undefined → no `respondWith` →
native network delivery. Verified by re-reading `defaultCache` end-to-end.

## Files changed (allow-list)

* `lib/sw/telemetry-bypass.ts` — new pure predicate module (~45 lines).
* `app/sw.ts` — added import; replaced regex matcher with function matcher.
* `__tests__/sw/telemetry-bypass.test.ts` — new test file (7 cases).
* `tasks/wave-182-telemetry-vitals.md` — this spec doc.

Untouched (per dispatch instructions): the route handler, all CSP /
security / auth files, the page-side send code (already correct).

## Verification

* `pnpm vitest run __tests__/sw/telemetry-bypass.test.ts` — 7/7 pass.
* `npx tsc --noEmit` — green.
* `pnpm lint` — green.
* `pnpm build --webpack` — green (validates the SW still bundles).

### Post-deploy verification (manual, in prod or branch preview)

1. Open the site, open DevTools → Network panel, filter by `vitals`.
2. Hard-navigate between two routes (e.g. `/farms/test/dashboard` →
   `/farms/test/animals`).
3. Expect: `POST /api/telemetry/vitals` rows show as `(200)` or
   `(202)` — never `(canceled)` / `ERR_ABORTED`.
4. Repeat for `client-errors` (trigger a benign client-side warning to
   confirm the second telemetry endpoint also passes through cleanly).
5. After ~5 minutes, inspect the meta-DB `vitals_events` table — fresh
   rows should be appearing again.

## Closes

Production triage P2.2.
