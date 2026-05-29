# Telemetry diagnosis discipline

When a telemetry beacon shows a browser-console net error (`ERR_ABORTED`, a red
`Failed to load resource`, or a stray `500` on `/api/telemetry/*`), triage the
**transport chain client-to-server in order** before suspecting the server route:

1. **SW matcher** (`app/sw.ts` + `lib/sw/telemetry-bypass.ts`) — a `NetworkOnly`
   `/api/*` rule that intercepts the request re-runs `fetch` *inside* the worker,
   which does NOT inherit `keepalive`/beacon semantics, so the response promise
   aborts as the page unloads. Telemetry must bypass the SW: the `/api/*` matcher
   returns `false` for `/api/telemetry/` so `event.respondWith` is never called
   and the browser delivers natively. (Confirmed for both `/vitals` and
   `/client-errors`; vitals POST yields a native `202` after navigation.)
2. **Client delivery API** (`components/ReportWebVitals.tsx`,
   `lib/client-logger.ts`) — unload-time sends must use `navigator.sendBeacon`
   (background-send queue, independent of document lifetime), falling back to
   `fetch({ keepalive: true })`. A plain `fetch` at unload can abort.
3. **Proxy matcher** (`proxy.ts` `config.matcher`) — telemetry paths are in the
   negative-lookahead exclusion list, so middleware never 307s them to `/login`.

Only AFTER all three are cleared should you look at the server route. The
`/api/telemetry/client-errors` route is already correct: aborted/garbage bodies
return `400` (typed `invalid_json`), the logger forward is throw-proofed, and
success is `202`. A transport-level `500`/abort surfaced in devtools on an
aborted unload POST is a **platform artifact, not a server bug** — do NOT broaden
the server `catch` (it would silence real `400`s) and do NOT touch the web-vitals
reporter's `keepalive` (chasing a non-cause). See issue #490 (PRD #479, Epic E).
