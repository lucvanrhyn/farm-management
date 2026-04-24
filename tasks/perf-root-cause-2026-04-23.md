# FarmTrack Perf — Root-Cause Audit (2026-04-23)

**Scope:** Production https://farm-management-lilac.vercel.app, measured via playwright-cli from Cape Town. Tenant: `trio-b-boerdery` (874 animals, 19 camps).
**State of previous perf work:** PR #8 (`perf/foundation`, 8 phases) merged to `main` earlier today. This audit measures what the merged-but-unconfigured foundation is actually delivering.

---

## Production measurements (cold, no-cache)

| Page / endpoint                       | TTFB      | Load end | Transfer | Notes                                         |
| ------------------------------------- | --------- | -------- | -------- | --------------------------------------------- |
| `/` → redirect `/login`               | 0.87 s    | —        | 15 B     | Redirect costs a full edge→iad1 round-trip.   |
| `/login` (public)                     | 0.87 s    | —        | 11 KB    | Ships ~230 KB brotli / 715 KB JS.             |
| `/trio-b-boerdery/home`               | 1.50 s    | 1.62 s   | 18 KB    | Fires `/api/farm` + vitals after paint.       |
| `/trio-b-boerdery/dashboard` (SSR)    | **4.14 s** | 4.52 s  | 59 KB    | Then `/api/camps/status` adds 2.11 s.         |
| `/trio-b-boerdery/admin` (SSR)        | 2.24 s    | 5.17 s   | 61 KB    | `/api/notifications` alone 3.57 s.            |
| `/trio-b-boerdery/admin/animals` SSR  | 2.90 s    | 4.79 s   | **557 KB** | Renders all 874 animals into HTML, no LIMIT. |
| `/trio-b-boerdery/logger`             | 1.57 s    | 2.07 s   | 19 KB    | Fan-out of 7 API calls, see below.            |

### API endpoints (rapid-fire, warm)

| Endpoint                           | TTFB (try1) | try2  | try3  | try4  | try5  |
| ---------------------------------- | ----------- | ----- | ----- | ----- | ----- |
| `/api/farm` (30 s cache)           | 0.98 s      | 0.69 s | 0.69 s | 0.62 s | 0.77 s |
| `/api/camps/status` (60 s cache)   | 0.69 s      | 0.64 s | 0.65 s |       |       |
| `/api/notifications` (uncached)    | 1.08 s      | 0.81 s | 0.90 s |       |       |
| `/trio-b-boerdery/dashboard` SSR   | 3.60 s      | 3.02 s | 3.11 s |       |       |
| `/api/animals?limit=500`           | 1.05 s      | 1.00 s |        |       |       |

> The flat 0.6-0.8 s floor on every "cached" endpoint is the smoking gun: the
> 30 s `unstable_cache` layer is either not serving, or the non-cache part of
> the request path (session + Prisma get + Turso round-trip) costs more than
> the DB query it saves.

### Logger page API fan-out (cold visit)

```
/api/camps                              2535 ms    ← CampWarmup prefetch
/api/tasks?status=...&assignee=luc@...  1611 ms    ← uncached
/api/camps                              3125 ms    ← OfflineProvider refreshCachedData (DUPLICATE)
/api/animals?limit=500                  2499 ms    ← syncs ALL animals to IndexedDB
/api/camps/status                       1282 ms
/api/farm                               1371 ms
/api/animals?limit=500&cursor=KO-449    1156 ms    ← pagination page 2
```

Seven in-flight requests, ~13.5 s total serial DB time (parallelized by the
browser to ~3-4 s wall), two of them redundant.

---

## Root causes (ranked by impact)

### 1. **Geographic triple-hop** — user → Vercel iad1 → Turso ap-northeast-1
**Evidence:**
- Response header: `x-vercel-id: cpt1::iad1::...` → request arrives at Cape Town edge but the function runs in `iad1` (Washington DC, US).
- `.env.local` shows `TURSO_DATABASE_URL=libsql://trio-b-boerdery-lucvanrhyn.aws-ap-northeast-1.turso.io` → the Turso DB lives in **Tokyo**.
- Repeatable ~600 ms floor on every endpoint that hits the DB at all, regardless of which endpoint or how "cheap" the query.

**Why it dominates:** Cape Town → Virginia is ~230 ms RTT. Virginia → Tokyo is ~160 ms RTT. A single Prisma query therefore costs **≥ 400 ms of pure network** before any compute, and a page that runs 8 parallel queries is still bounded by the slowest one's network latency. No amount of in-code optimization can beat that floor.

**Why the previous perf work didn't solve this:** Phases 2/4/8 reduced the *number* and *arrangement* of Prisma queries but did nothing about their per-query latency. The cache layer (Phase 2) is supposed to eliminate those hops on cache hits, but it's not actually serving (see #2).

**Long-term fix options:**
- Move Turso DB to `aws-us-east-1` (co-located with Vercel `iad1`) — removes the Pacific hop.
- Or move Vercel functions to `fra1` / `cpt1` edge and Turso to a closer region — removes the Atlantic hop.
- Best: co-locate both as close to the user base as Vercel supports (SA has no region yet; `fra1` Frankfurt is closest).

---

### 2. **`FARM_CACHE_ENABLED_SLUGS` is unset in production**
**Evidence:**
- `vercel env ls` shows the var only on `Preview (perf/foundation)`, never on `Production`.
- `lib/flags.ts` returns `false` for every slug when the var is unset (line 32-36).
- `app/[farmSlug]/dashboard/page.tsx:22` gates the entire cached data path on `isCacheEnabled(farmSlug)`. When false, it falls through to a literal 8-query `Promise.all` against live Turso (lines 46-63).
- `app/[farmSlug]/layout.tsx:18` and `app/farms/page.tsx:14` do the same.

**Why the previous perf work didn't solve this:** The memory note said "Vercel env var set on `preview perf/foundation`" but no one promoted it to production after PR #8 merged. The flag-gated code paths ship, but the flag is dark, so every tenant hits the uncached branch.

**Why the flat 0.6-0.8 s floor on `/api/farm` despite being "cached":** Even the API routes that unconditionally use `getCachedFarmSummary` / `getCachedCampList` still pay the same floor. Three possibilities, in order of likelihood:
1. Session + Prisma client acquisition (`getServerSession` + `getPrismaWithAuth` + the 5-minute `SELECT 1` probe in `getPrismaForFarm`) costs ~400-600 ms per request on its own, dwarfing the query it's caching.
2. The cached fetcher's `tags` array includes `farmTag(slug, "animals")` + `farmTag(slug, "camps")` — any write anywhere evicts aggressively (30 s TTL in practice often doesn't bite because tags invalidate first).
3. `unstable_cache` on Vercel Data Cache is slower than Next's in-memory LRU would be for a value this small; every read is itself a network call to Vercel's cache service.

This needs direct instrumentation (a timestamp log inside and outside the `unstable_cache` wrapper) to split.

---

### 3. **Logger fans out 6-7 parallel API calls, two of them duplicate**
**Evidence:**
- `app/[farmSlug]/logger/layout.tsx:74` — `CampWarmup` fires `fetch("/api/camps")` the moment the layout mounts, independent of any state.
- `components/logger/OfflineProvider.tsx:185-196` — on mount, if `lastSyncedAt > 60 s` old, calls `refreshData()` → `refreshCachedData()`.
- `lib/sync-manager.ts:96-101` — `refreshCachedData` issues `/api/camps` + `fetchAllAnimalsPaged()` + `/api/farm` + `/api/camps/status` **in parallel**, so `/api/camps` runs twice concurrently.
- Measured: two independent `/api/camps` calls completing 2535 ms and 3125 ms on the same page load.

**Why the previous perf work didn't solve this:** Phase 4 "TTL-gate logger fan-out + dedup /api/farm" gated the fan-out on sync age but didn't de-duplicate against `CampWarmup`. `CampWarmup` exists for a different purpose (prefetch per-camp HTML via `next/link`) but it happens to issue the same request.

**Long-term fix options:**
- Have `CampWarmup` subscribe to `useOffline().camps` instead of fetching directly — it runs after the OfflineProvider cache is hot.
- Or merge the two mechanisms: give `refreshCachedData` a post-sync step that warms the per-camp HTML.
- Stop paginating `/api/animals?limit=500` for sync — 874 animals is one page if `limit=1000`, two sequential pages is 2× network penalty.

---

### 4. **Admin pages SSR entire collections with no pagination**
**Evidence:**
- `app/[farmSlug]/admin/animals/page.tsx:31` — `prisma.animal.findMany({ where: { species: mode }, orderBy: [...] })` — no `take`, no `skip`. Trio B has 874 active animals → all 874 are fetched, hydrated into Prisma objects, serialized into HTML.
- Measured HTML payload: **557 KB** transferred, ~2.9 s TTFB, ~4.8 s load.
- `AnimalsTable` receives all 874 as a prop; every row becomes DOM on every admin visit.

**Why the previous perf work didn't solve this:** Phase 4 added cursor pagination to `/api/animals` (client-side) but left the server-rendered admin pages untouched. SSR still renders the full list.

**Long-term fix options:**
- Server-side paginate admin tables (render page 1, use search param `?cursor=` for subsequent pages).
- Or render a lightweight shell server-side and let the client fetch pages via `/api/animals?limit=50&cursor=...` (the paginated API already exists, it's just unused by the admin route).
- Same pattern audit should be done on `/admin/observations`, `/admin/reproduction`, etc. — any `findMany` without `take` is a latent problem that scales linearly with tenant size.

---

### 5. **`/api/notifications` is not cached and runs a live Prisma query on every nav**
**Evidence:**
- `app/api/notifications/route.ts` — plain `prisma.notification.findMany(...)`, no `unstable_cache`, no conditional fetch.
- `NotificationBell` polls this route every 60 s (per memory note, confirmed by the periodic `/api/notifications` hits in warm traces).
- Measured: 800-1100 ms consistently, 26 KB payload.
- Also runs on every admin page's initial render because `NotificationBell` is in `AdminNav`.

**Why the previous perf work didn't solve this:** Phase 2's cache rollout included 8 helpers; notifications wasn't in scope. It's new Phase J infrastructure and landed after Phase 2 shipped.

**Long-term fix options:**
- Add `getCachedNotifications(slug, userEmail)` with ~15 s revalidate + tag-invalidate on notification write.
- Or hoist the bell's polling into a single `EventSource` / Server-Sent-Event stream so the bell doesn't issue one-request-per-bell-per-nav.
- Cheapest fix: return a `Cache-Control: private, max-age=15` response so the browser suppresses redundant fetches within a polling window.

---

### 6. **Session + Prisma client acquisition is on the hot path of every API route**
**Evidence:**
- Every API route starts with `getServerSession(authOptions)` → `getPrismaWithAuth(session)` → `getPrismaForRequest` → `getPrismaForFarm(slug)`.
- `lib/farm-prisma.ts` has a 5-minute `SELECT 1` probe per farm client; first probe after expiry is a round-trip to Tokyo.
- `getPrismaForFarm` creates a new `PrismaClient` + libSQL adapter on cache miss — Prisma client instantiation is ~50 ms even when warm.
- Repeated measurements of different tiny endpoints all bottom out at the same 0.6-0.8 s floor → this overhead dominates anything called less often than once per minute.

**Why the previous perf work didn't solve this:** Phase 0 "drop libSQL probes + add retry wrappers" removed one set of probes but kept the 5-minute revalidation probe. That probe is defensive against token rotation but happens on the first request after a cold function.

**Long-term fix options:**
- Lift session verification into `proxy.ts` once, attach decoded session to the request, have API routes read from request headers instead of re-decoding JWT.
- Make `getPrismaForFarm`'s probe **lazy / background** — serve the stale client and repair it in the background after the response ships.
- Pool Prisma clients globally, not per-farm — the current per-slug cache means one function instance may create N clients for N farms.

---

### 7. **Login page ships ~715 KB of JavaScript (brotli ~230 KB)**
**Evidence:**
- Login page HTML references 6 JS chunks totaling 715 KB uncompressed / 228 KB brotli: `194` (227 KB), `4097ec82` (200 KB), `6300` (129 KB), `polyfills` (113 KB), plus smaller layout/page chunks.
- Login has no business logic — just an email + password form. Those chunks include the full layout/providers for the rest of the app.

**Why the previous perf work didn't solve this:** Phase 3 code-split logger modals and framer-motion from CampSelector; it didn't route-split login from the dashboard bundle. Login uses the same `app/layout.tsx` tree as every other page, so it inherits the whole provider stack.

**Long-term fix options:**
- Put `/login` + `/register` in a route group with its own minimal layout that doesn't load dashboard providers (IndexedDB, session context, push worker).
- Audit the `194` + `4097ec82` chunks with `next-bundle-analyzer` — any one of mapbox-gl / jspdf / recharts / openai client being imported in the top layout is a cliff.
- Shipping 113 KB of polyfills in 2026 is suspicious; `browserslist` probably has stale legacy targets.

---

### 8. **Serwist (PWA) masks the problem on repeat visits, hiding the regression**
**Evidence:**
- Measured warm reload of `/logger`: TTFB 2 ms, transfer 0 B, `/api/camps` + `/api/animals` + `/api/farm` all served from Serwist IndexedDB cache. Only `/api/tasks` (Phase K, not yet in Serwist runtime cache) still hit the network.
- Warm reload of `/dashboard`: TTFB 1 ms, only `/api/camps/status` re-fetched.

**Why this matters:** On a repeat visit the app feels instant because Serwist serves the HTML shell from cache. But **the first visit every day, every hard-refresh, every new device, and every incognito window gets the full 4 s cold experience**. This is the "a month later it's slow again" pattern — as soon as IndexedDB is evicted or the app is uninstalled/reinstalled, perf is measured against the actual server, not the cache.

**Long-term fix options:**
- Treat the unrefreshed, logged-in-from-scratch experience as the canonical benchmark. Add a Lighthouse CI run with `--clear-storage` before each measurement.
- Consider Serwist's `NetworkFirst` strategy with a 2-3 s timeout on API routes so the cache doesn't mask degrading server perf.

---

## Summary: why perf keeps regressing

Every previous pass optimized the *query layer* (reduce queries, parallelize, paginate, cache). None of them addressed:

1. **Physical placement** — fn in US-East, DB in Tokyo, user in South Africa. This sets a ~600 ms floor that no in-code change can beat.
2. **Feature flag never flipped to production** — the cache layer that's supposed to eliminate the Tokyo hop is dark for every tenant.
3. **Shared app-shell overhead** — auth + Prisma acquire overhead runs on every route, dwarfing the work it guards for small responses.
4. **PWA masks degradation** — warm reloads look fast; cold reloads (the real user experience on day 1 and after any cache eviction) were never the canonical test.

If we only fix causes #2-#7 without fixing #1, perf will keep drifting back to "slow" every time a new feature adds a query or bypasses the cache, because the floor under every request is still 600 ms of network. The durable fix is geographic co-location; everything else is just reducing the multiplier on that floor.

---

## Not fixing in this pass (per user request)

This audit stops at identification. Any fix should:
1. Pick a primary lever (region move vs. cache flag promotion vs. both).
2. Re-measure from cold (Serwist cleared) to verify the floor actually moves.
3. Add a Lighthouse CI budget that fails PRs that regress TTFB on the benchmark pages.
