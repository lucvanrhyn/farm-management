# FarmTrack Perf — Phased Fix Plan (2026-04-23)

> **Source:** `tasks/perf-root-cause-2026-04-23.md` (8 root causes measured on prod).
> **This document:** chronological execution plan — Wave 1 runs in parallel worktrees with TDD, Wave 2 runs sequentially after Wave 1 merges.

**Goal:** Eliminate the ~600 ms per-request network floor and the systemic app-shell overhead that makes every cold visit feel slow, without re-introducing the 2–4 week regression cycle.

**Architecture philosophy:**

1. **Measure before and after every phase from cold.** Warm (Serwist-cached) reloads hid the regression last time. Every phase has a cold-Lighthouse gate.
2. **Structural fixes over tactical caches.** Adding another `unstable_cache` around a slow path is *why* we're here. Phases attack network topology, SSR payload shape, and session overhead — the levers that generalize.
3. **Ship in reversible slices.** Each phase is independently deployable, revertable, and measurable.

**Tech stack in scope:** Next.js 16 App Router, Vercel iad1, Turso (libSQL) ap-northeast-1, Prisma 5 + @prisma/adapter-libsql, next-auth v4 JWT, Serwist PWA.

---

## Phase index

| # | Phase                                   | Root cause | Risk | Effort     | Wave |
|---|-----------------------------------------|------------|------|------------|------|
| 0 | Promote `FARM_CACHE_ENABLED_SLUGS=*`    | #2         | Low  | 30 min     | Wave 1 (prereq, main session) |
| 1 | Cold-perf observability (LHCI + timings)| #8         | Low  | ½ day      | Wave 1 (worktree) |
| 2 | De-dupe logger fan-out                  | #3         | Low  | ½ day      | Wave 1 (worktree) |
| 3 | SSR pagination on admin list pages      | #4         | Med  | 1–2 days   | Wave 1 (worktree) |
| 4 | Cache + throttle `/api/notifications`   | #5         | Low  | ½ day      | Wave 1 (worktree) |
| 5 | Minimal app-shell for auth routes       | #7         | Med  | 1 day      | Wave 1 (worktree) |
| 6 | Session + Prisma acquire to `proxy.ts`  | #6         | High | 2–3 days   | Wave 2 (after Wave 1 merges) |
| 7 | Geographic co-location                  | #1         | High | 1–2 days + migration | Wave 2 (after P6) |

---

## Wave 1 — Parallel execution

**Strategy:** Five code-bearing phases (P1–P5) dispatch simultaneously, each in its own isolated git worktree. Every worktree agent follows the **`/tdd`** skill (red → green → refactor, tests first). P0 is a 30-second env flip the operator does once in the main session before dispatching worktrees so Wave 1 measurements start with the cache flag on.

**File-ownership contract (prevents parallel-dispatch collisions):**

| File                                      | Owner in Wave 1 |
|-------------------------------------------|-----------------|
| `lib/server/server-timing.ts` (new)       | P1              |
| `lib/farm-prisma.ts`                      | P1 (probe timer only) |
| `app/api/farm/route.ts`                   | P1              |
| `app/api/camps/route.ts`                  | P1              |
| `app/api/camps/status/route.ts`           | P1              |
| `app/api/animals/route.ts`                | P1              |
| `app/api/tasks/route.ts`                  | P1              |
| `app/api/notifications/route.ts`          | **P4** (includes Server-Timing) |
| `app/[farmSlug]/logger/layout.tsx`        | P2              |
| `lib/sync-manager.ts`                     | P2              |
| `components/logger/OfflineProvider.tsx`   | P2              |
| `app/[farmSlug]/admin/animals/page.tsx`   | P3              |
| `app/[farmSlug]/admin/observations/page.tsx` | P3           |
| `app/[farmSlug]/admin/reproduction/page.tsx` | P3           |
| `app/[farmSlug]/admin/treatments/page.tsx` | P3            |
| `app/[farmSlug]/admin/finance/page.tsx`   | P3              |
| `components/admin/AnimalsTable.tsx` (+ other list tables) | P3 |
| `lib/server/cached.ts`                    | P4 (add `getCachedNotifications`) |
| `lib/server/cache-tags.ts`                | P4 (add notifications scope) |
| `lib/server/revalidate.ts`                | P4 (add `revalidateNotificationWrite`) |
| `lib/server/notification-generator.ts`    | P4 (invalidate tag on write) |
| `components/admin/NotificationBell.tsx`   | P4              |
| `app/login/` → `app/(auth)/login/`        | P5 (move)       |
| `app/register/`, `forgot-password`, `verify-email` → `app/(auth)/…` | P5 (move) |
| `app/(auth)/layout.tsx` (new)             | P5              |
| `package.json` browserslist               | P5              |
| `proxy.ts` line 18 farmRouteMatch         | **touch-by-exception** — anyone who changes it coordinates in chat |

Any phase modifying a file not in its column must pause and coordinate.

### P0 — Promote `FARM_CACHE_ENABLED_SLUGS` to Production (prerequisite, main session)

Runs in the main session before Wave 1 worktrees dispatch.

```bash
# Verify preview has been green for 24+ h with trio-b on the cache path
vercel env ls preview | grep FARM_CACHE_ENABLED_SLUGS

# Promote to production
vercel env add FARM_CACHE_ENABLED_SLUGS production
# prompt: * (star, comma-less)

# Redeploy main to pick up the var
vercel redeploy --prod

# Verify
curl -sI -H "Cookie: ..." https://farm-management-lilac.vercel.app/api/farm | grep -i x-vercel-id
# Confirm Server-Timing improvement once P1 lands.
```

**Rollback:** `vercel env rm FARM_CACHE_ENABLED_SLUGS production && vercel redeploy --prod`. Zero code changes.

**Why prerequisite:** Wave 1 needs the cache path live so LHCI baselines (P1) reflect the intended production shape. Measuring with the flag off would give misleading "before" numbers for P2–P5.

---

### Dispatch sequence (single message, 5 agents in parallel)

After P0 is flipped, dispatch these five agents in a single message so they run concurrently. Each creates its own worktree from `origin/main` via **`superpowers:using-git-worktrees`** and executes task-by-task under **`/tdd`** (red-green-refactor).

---

### P1 — Worktree `perf/observability`

**Base branch:** `origin/main`
**Worktree path:** `.worktrees/perf-observability`
**TDD harness:** run **`/tdd`** inside the worktree. Write failing tests first for every new behavior, watch them fail, implement minimally, then refactor.

**Dispatch brief (paste as the agent's prompt):**

```
ROLE: You are implementing Phase 1 of the FarmTrack perf plan (cold-perf observability). Full plan: `tasks/perf-phased-plan-2026-04-23.md`. Root-cause report: `tasks/perf-root-cause-2026-04-23.md`.

WORKTREE: Invoke superpowers:using-git-worktrees first to create `.worktrees/perf-observability` from origin/main. All work happens there.

METHOD: Invoke the `/tdd` skill. Every change is preceded by a failing test.

SCOPE (owned files only — do not touch any other file):
- Create: lib/server/server-timing.ts
- Create: lighthouserc.js
- Create: .github/workflows/lhci.yml
- Create: scripts/bench-snapshot.ts
- Create: tasks/bench/latest.json (ignored by git initially, written by the script)
- Modify: lib/farm-prisma.ts — wrap getPrismaForFarm's probe + acquire in a timer that pushes to a request-scoped timings array
- Modify app/api/farm/route.ts, app/api/camps/route.ts, app/api/camps/status/route.ts, app/api/animals/route.ts, app/api/tasks/route.ts — wrap each handler's return with a helper that emits `Server-Timing: session;dur=X, prisma-acquire;dur=Y, query;dur=Z`

EXCLUDED (owned by other phases):
- app/api/notifications/route.ts → P4 will add Server-Timing itself
- Any `app/[farmSlug]/**` or `components/admin/**` file → P3 territory
- Any `app/login`, `app/(auth)` file → P5 territory
- Any `components/logger/**`, `lib/sync-manager.ts`, logger layout → P2 territory

BEHAVIOUR:
- Server-Timing helper: accepts a map of labelled timings, emits a single header. Max 8 entries. Never throws.
- Prisma probe timer: zero overhead when no request is in flight. Don't break the request if the timing emit fails.
- LHCI workflow: runs on every PR to main, measures 5 URLs (/login, /delta-livestock/home, /delta-livestock/dashboard, /delta-livestock/logger, /delta-livestock/admin/animals) with `--clear-storage` via a bench user `e2e-bench@farmtrack.app` (add a secret BENCH_PASSWORD). Budgets: FCP<2s, LCP<3s, TTI<4s, login total JS<300KB brotli.

TESTS (write these first, see them fail, then implement):
1. `lib/server/__tests__/server-timing.test.ts` — header formats correctly, handles empty timings, truncates past 8 entries, escapes label characters.
2. `lib/__tests__/farm-prisma-timing.test.ts` — probe timer records duration; mock prisma client; assert timing is within ±5ms of mocked work.
3. `scripts/__tests__/bench-snapshot.test.ts` — snapshot writer produces valid JSON with expected schema.

VERIFICATION:
- `pnpm vitest run lib/server/__tests__/server-timing.test.ts lib/__tests__/farm-prisma-timing.test.ts` green.
- `pnpm tsc --noEmit` green (after `rm -rf .next/cache/tsbuildinfo .tsbuildinfo`).
- `pnpm build --webpack` green.
- `curl -sI` on any of the instrumented routes on a running dev server shows the `Server-Timing` header.
- Open a PR to trigger LHCI; confirm it produces a numeric report (first run may be "baseline", that's fine — it sets the budget).

COMMIT DISCIPLINE:
- One commit per task step (test, then impl, then refactor). Conventional commits: `test(perf): …`, `feat(perf): …`, `refactor(perf): …`.
- Do NOT merge or rebase onto main until told. Open a PR from the worktree branch `perf/observability` targeting `main` and return the PR URL.

RETURN DELIVERABLE: PR URL + summary of what landed + link to the first LHCI run's artifact + before/after curl sample of Server-Timing on one route.
```

---

### P2 — Worktree `perf/logger-dedupe`

**Base branch:** `origin/main`
**Worktree path:** `.worktrees/perf-logger-dedupe`
**TDD:** `/tdd` inside.

**Dispatch brief:**

```
ROLE: Phase 2 — de-dupe the logger page's cold-visit API fan-out. Full plan: `tasks/perf-phased-plan-2026-04-23.md`. Root-cause: entry #3 in `tasks/perf-root-cause-2026-04-23.md`.

WORKTREE: superpowers:using-git-worktrees → `.worktrees/perf-logger-dedupe` off origin/main.

METHOD: `/tdd`. Tests first.

SCOPE (owned files only):
- Modify: app/[farmSlug]/logger/layout.tsx (CampWarmup component internals)
- Modify: components/logger/OfflineProvider.tsx (expose campsLoaded if not already; add a one-shot promise that resolves on first cache-or-fetch completion)
- Modify: lib/sync-manager.ts — change `fetchAllAnimalsPaged` default limit from 500 to 1000 (keep 500 as a secondary page for farms with > 1000 animals)
- Create: __tests__/logger/camp-warmup-single-fetch.test.tsx

EXCLUDED:
- Any /api/**/route.ts → P1/P4 territory
- Any app/[farmSlug]/admin/** → P3
- Login/register → P5

BEHAVIOUR:
- CampWarmup must consume `useOffline().camps` (waiting for `campsLoaded === true`) rather than issue its own `fetch('/api/camps')`. When camps arrive via the OfflineProvider, CampWarmup begins its per-camp HTML prefetch loop.
- sync-manager.refreshCachedData stays the single authoritative caller of /api/camps.
- Default animal sync page size rises to 1000 so trio-b (874 animals) completes in one round-trip instead of two.

TESTS (write first):
1. __tests__/logger/camp-warmup-single-fetch.test.tsx — mount LoggerLayout with a mocked OfflineProvider; spy on global fetch; assert exactly one GET /api/camps after initial load settles.
2. __tests__/logger/offline-provider-campsloaded.test.tsx — OfflineProvider exposes campsLoaded=true after first cache read resolves, even when cache is empty.
3. __tests__/sync-manager/fetchAllAnimalsPaged.test.ts — with mocked /api/animals returning 874 rows in one response, verify only ONE network call happens.

VERIFICATION:
- All three new tests green. Previously-passing logger tests still green.
- `pnpm tsc --noEmit` clean.
- Manually visit /delta-livestock/logger in dev with DevTools Network tab → exactly one /api/camps entry, exactly one /api/animals entry on cold load.

COMMIT DISCIPLINE: one commit per step, conventional commits, PR `perf/logger-dedupe` → `main`.

RETURN: PR URL + before/after network screenshots (or request-count summary) from /logger cold.
```

---

### P3 — Worktree `perf/admin-pagination`

**Base branch:** `origin/main`
**Worktree path:** `.worktrees/perf-admin-pagination`
**TDD:** `/tdd` inside.

**Dispatch brief:**

```
ROLE: Phase 3 — add SSR pagination to admin list pages so HTML payload caps at ~100 KB regardless of tenant size. Root-cause: entry #4.

WORKTREE: superpowers:using-git-worktrees → `.worktrees/perf-admin-pagination`.

METHOD: `/tdd`. Tests first.

SCOPE (owned files only):
- Modify: app/[farmSlug]/admin/animals/page.tsx — add `?cursor` + `take: 50` to the findMany; thread searchParams through.
- Modify: app/[farmSlug]/admin/observations/page.tsx — same pattern.
- Modify: app/[farmSlug]/admin/reproduction/page.tsx — check if it has a list; if yes, same pattern.
- Modify: app/[farmSlug]/admin/treatments/page.tsx — same.
- Modify: app/[farmSlug]/admin/finance/page.tsx — same for the transactions list.
- Modify: components/admin/AnimalsTable.tsx and peers — accept `initialRows`, `nextCursor`, and a `fetchPage` prop that hits /api/animals?cursor=... (API already exists from Phase 4 of previous perf work). Implement scroll-to-load or explicit "Load more" button.
- Create: scripts/audit-findmany-no-take.ts — grep the repo for `prisma\.\w+\.findMany\(` that lacks `take:` in the same call; fail with a report listing offenders.
- Create: .github/workflows/audit-pagination.yml — run the script on every PR.

EXCLUDED: anything under /api/, /logger/, /login, (auth), notifications bell, shared lib/server/cached.ts (P4).

BEHAVIOUR:
- First SSR render: 50 rows. Scroll/Load-more fetches /api/animals?limit=50&cursor=<last>.
- Audit script: if a findMany is used for a legitimate single-record lookup (has `where: { id | animalId | campId: ... }` returning uniquely), that's allowed. Only `findMany` without both `take:` AND a unique-column `where` fails.

TESTS (write first):
1. __tests__/admin/animals-page-pagination.test.tsx — render admin/animals page with mocked Prisma returning 200 animals; assert rendered DOM has 50 rows, has a Load more control.
2. __tests__/admin/animals-page-html-size.test.ts — hit /delta-livestock/admin/animals with next-test; assert HTML < 100 KB.
3. __tests__/admin/observations-page-pagination.test.tsx, treatments, finance — parallel.
4. scripts/__tests__/audit-findmany-no-take.test.ts — happy path (no offenders), sad path (returns offenders), ignores unique-key findMany.

VERIFICATION:
- All new tests green. Existing admin page tests still green.
- `pnpm tsc --noEmit` clean.
- Manual: visit /delta-livestock/admin/animals in dev; view-source; confirm HTML < 100 KB; confirm scroll loads the next 50.
- Run `pnpm tsx scripts/audit-findmany-no-take.ts` — should report zero offenders after your changes.

COMMIT DISCIPLINE: one commit per step, PR `perf/admin-pagination` → `main`.

RETURN: PR URL + before/after HTML byte count for /admin/animals + audit script output.
```

---

### P4 — Worktree `perf/notifications-cache`

**Base branch:** `origin/main`
**Worktree path:** `.worktrees/perf-notifications-cache`
**TDD:** `/tdd` inside.

**Dispatch brief:**

```
ROLE: Phase 4 — cache and throttle /api/notifications so the 60s poll doesn't cost 800-1100ms per hit. Root-cause: entry #5.

WORKTREE: superpowers:using-git-worktrees → `.worktrees/perf-notifications-cache`.

METHOD: `/tdd`. Tests first.

SCOPE (owned files only):
- Modify: lib/server/cached.ts — add `getCachedNotifications(slug, userEmail)` with `revalidate: 30` and tags `[farmTag(slug, "notifications"), notificationTag(userEmail)]`.
- Modify: lib/server/cache-tags.ts — add `"notifications"` scope + `notificationTag(userEmail)` helper.
- Modify: lib/server/revalidate.ts — add `revalidateNotificationWrite(slug, userEmail?)`.
- Modify: app/api/notifications/route.ts — replace live prisma call with the cached helper; add `Cache-Control: private, max-age=15, stale-while-revalidate=45` response header; ALSO emit Server-Timing (P1's server-timing.ts helper must exist — if it doesn't yet, stub a minimal compatible version and mark a TODO for P1 to consolidate).
- Modify: lib/server/notification-generator.ts — call revalidateNotificationWrite after every write.
- Modify: components/admin/NotificationBell.tsx — raise the polling interval from 60s to 120s (browser cache covers the gap within a single poll window).

EXCLUDED: any /api route other than /notifications; any dashboard/admin page body; proxy.ts; auth routes.

BEHAVIOUR:
- Second hit within 15s: served from browser cache (no network request at all).
- Hit between 15-60s: revalidate-in-background via the SWR window.
- Mark-read mutation invalidates the notificationTag so the next read sees updated isRead state without waiting out the TTL.

TESTS (write first):
1. lib/server/__tests__/cached-notifications.test.ts — two back-to-back calls within 30s return identical data from cache (single Prisma invocation).
2. lib/server/__tests__/revalidate-notifications.test.ts — mutation-path helper calls revalidateTag with both farm + user tags.
3. __tests__/api/notifications-cache-control.test.ts — response carries `Cache-Control: private, max-age=15, stale-while-revalidate=45`.
4. __tests__/components/NotificationBell-polling.test.tsx — interval is 120000ms; manual refresh still works.

COORDINATION NOTE ON SERVER-TIMING:
P1 is writing `lib/server/server-timing.ts` in parallel. If that file doesn't exist in your worktree, create a minimal `emitServerTiming({session, prismaAcquire, query}: Record<string,number>): string` that returns a header-value string; if it DOES exist (P1 merged first), import from there. On rebase, defer to P1's interface.

VERIFICATION:
- `pnpm vitest run` green on new tests.
- `pnpm tsc --noEmit` clean.
- Manual: tail the Network tab on /admin for 30s; second /api/notifications hit shows `(disk cache)` / no request.
- Manual: create a notification via cron or direct DB insert; confirm bell updates on next poll (within 120s).

COMMIT DISCIPLINE: one commit per step, PR `perf/notifications-cache` → `main`.

RETURN: PR URL + Network screenshot showing disk-cache hit + proof of mark-read invalidation.
```

---

### P5 — Worktree `perf/auth-bundle`

**Base branch:** `origin/main`
**Worktree path:** `.worktrees/perf-auth-bundle`
**TDD:** `/tdd` inside.

**Dispatch brief:**

```
ROLE: Phase 5 — strip the auth routes down to a minimal app-shell so /login ships ≤ 100 KB brotli instead of 228 KB. Root-cause: entry #7.

WORKTREE: superpowers:using-git-worktrees → `.worktrees/perf-auth-bundle`.

METHOD: `/tdd`. Tests first (note: some tests here are size-assertions against a built bundle).

SCOPE (owned files only):
- Move: app/login/ → app/(auth)/login/
- Move: app/register/ → app/(auth)/register/
- Move: app/forgot-password/ → app/(auth)/forgot-password/
- Move: app/verify-email/ → app/(auth)/verify-email/
- Create: app/(auth)/layout.tsx — minimal HTML shell. NO OfflineProvider, NO FarmModeProvider, NO service-worker bootstrap, NO NotificationBell imports, NO next-auth SessionProvider (login page doesn't need it). Tailwind CSS only.
- Modify: package.json — update `browserslist` to drop IE, Safari < 13, Chrome < 90. Verify target by checking your expected user base (mostly modern mobile Safari/Chrome) before committing.
- Create: scripts/audit-bundle.ts — runs `@next/bundle-analyzer` or equivalent, asserts /login route total brotli < 100 KB, /register < 120 KB.
- Create: .github/workflows/audit-bundle.yml — runs the script on every PR.
- Verify: proxy.ts:18 `farmRouteMatch` and the auth-route allowlist still catch /login, /register, /forgot-password, /verify-email after the move. Route groups don't affect URLs but the regex must still be accurate. If it isn't, FIX proxy.ts minimally and note it in the PR description.

EXCLUDED: any /api route; any /[farmSlug]/** page; notifications; logger; admin pages.

BEHAVIOUR:
- /login renders with a tiny JS footprint — form submission still uses next-auth's `signIn()` client helper.
- Redirect-after-login still goes to /farms (or /active farm).
- Service worker is NOT registered on auth pages; it registers once the user lands on /[farmSlug]/* shells.

TESTS (write first where possible; some assertions run post-build):
1. __tests__/auth/login-route-group-move.test.ts — fetch /login from a running test server; receive 200; document title unchanged.
2. __tests__/auth/login-auth-still-works.test.tsx — sign-in flow still redirects to /farms on success.
3. scripts/__tests__/audit-bundle.test.ts — asserts the script fails if a route blows the budget; passes otherwise (use a fixture report).
4. Post-build assertion: `pnpm build --webpack && pnpm tsx scripts/audit-bundle.ts` — expect /login total brotli < 100 KB.

VERIFICATION:
- All tests green. Build output shows /login in a distinct chunk tree.
- `curl https://<preview-url>/login` HTML references ≤ 4 script tags.
- Proxy.ts still matches the moved routes.

COMMIT DISCIPLINE: one commit per step, PR `perf/auth-bundle` → `main`.

RETURN: PR URL + before/after total JS byte count for /login + list of dependencies that ended up being transitively imported into the login chunk (and whether any surprised you).
```

---

### Wave 1 integration gate

Before Wave 2 starts, the main session integrates all five PRs in this order:

1. **Merge P1 first.** `lib/server/server-timing.ts` lands cleanly (nothing else depends on it pre-merge).
2. **Merge P4.** P4's `/api/notifications/route.ts` includes its own Server-Timing call; if it imported a local stub, switch it to import from P1's `lib/server/server-timing.ts` in a 1-line follow-up commit.
3. **Merge P2, P3, P5 in any order.** They touch disjoint files.
4. **Run LHCI on `main`.** Capture the new cold-baseline numbers → `tasks/bench/wave1-baseline.json`. These are the "before" numbers for Wave 2.
5. **24-hour soak on production.** If Sentry shows no new error class and LHCI budgets hold, proceed to Wave 2.

**Stop condition:** if any PR fails its success gate or if the soak surfaces regressions, do NOT dispatch Wave 2. Open a focused debugging session on the broken phase first.

---

## Wave 2 — Sequential execution

Wave 2 phases each touch shared infrastructure (auth plumbing or DB topology) and cannot safely run in parallel with each other or with Wave 1.

### P6 — Session + Prisma acquire to `proxy.ts`

**Starts:** after Wave 1 has merged + soaked 24 h.
**Worktree:** `.worktrees/perf-edge-auth` off `origin/main` (post-Wave-1).
**TDD:** `/tdd`.

**High-level scope** (full dispatch brief generated when P6 kicks off):

- Extend `proxy.ts` to decode the NextAuth JWT once per request and attach signed headers (`x-farmtrack-user`, `x-farmtrack-role`, `x-farmtrack-slug`) using a server-only HMAC secret.
- Create `lib/server/request-auth.ts:readAuthFromRequest(req)` that verifies the signed headers and returns `{ userEmail, role, slug, prisma }`.
- Replace every `getServerSession + getPrismaWithAuth` call in `app/api/**/route.ts` (~40 files) with `readAuthFromRequest`. **Feature-flag per route** via `EDGE_AUTH_ROUTES` env — enable one route at a time, 1 h soak each, back out any that misbehave.
- Make `getPrismaForFarm`'s 5-minute probe lazy/background (schedule via `setImmediate`, never block the request).
- Replace per-farm Prisma client cache with a global LRU keyed by slug with an idle-eviction policy.

**Success gate:**
- Server-Timing `session;dur` drops from 50–100 ms to < 5 ms on warm routes.
- Server-Timing `prisma-acquire;dur` drops from 300–600 ms to < 20 ms on warm routes.
- All existing auth regression tests green. New security test: forged `x-farmtrack-user` header rejected with 401.

**Why after Wave 1:** P6 rebases on top of P1's Server-Timing plumbing and P2/P3/P4's route-handler shape. Rebasing P6 onto pre-Wave-1 `main` would mean rewriting those same route files twice.

---

### P7 — Geographic co-location

**Starts:** after P6 has merged + 48 h production soak.
**Worktree:** `.worktrees/perf-region-move` off `origin/main` (post-P6).
**TDD:** `/tdd` for the code changes (dual-write, meta-db URL lookup, cutover logic). Data migration itself is a scripted one-shot with row-count parity verification, not TDD.

**High-level scope** (full dispatch brief generated when P7 kicks off):

- Decide Option A (us-east-1) vs B (fra1 + eu-west-1) vs C (read-replicas). Recommendation: **Option B** for SA user base.
- Provision new Turso DBs per tenant in the target region via `turso db create --location fra`; run `turso db import` to copy data; verify row counts per table.
- Add `regionMigrationStatus` column to the meta `Farm` table. `lib/meta-db.ts:getFarmCreds()` returns per-tenant URLs based on this column.
- **Dual-write window (24 h):** writes go to both old (Tokyo) and new (Frankfurt) DBs; reads go to old. This lets us cut back over if Frankfurt misbehaves.
- **Cutover:** flip `regionMigrationStatus` per tenant; reads redirect to Frankfurt. Soak 48 h per tenant.
- **Vercel function region:** set `"regions": ["fra1"]` in `vercel.json`. Deploy.
- **Decommission:** after 7 days clean, remove dual-write, delete Tokyo DBs.

**Success gate:**
- Cold TTFB on `/delta-livestock/dashboard` drops to < 1 s (from Wave 1 baseline ~2 s — Wave 1 should have halved from the original 3–4 s).
- `x-vercel-id` header shows `cpt1::fra1::...`.
- Zero data loss (row-count parity per table per tenant, verified post-cutover).

**Why after P6:** P6 cut session/acquire overhead, so P7's pure network-latency win is measurable and not masked by compute overhead we hadn't fixed yet.

---

## Conflict matrix (retained for reference)

|         | P0 | P1 | P2 | P3 | P4 | P5 | P6 | P7 |
|---------|----|----|----|----|----|----|----|----|
| **P0** |  — | 🟢  | 🟢  | 🟢  | 🟢  | 🟢  | 🟢  | 🟢  |
| **P1** | 🟢  |  — | 🟢  | 🟢  | 🟢* | 🟢  | 🟡  | 🟡  |
| **P2** | 🟢  | 🟢  |  — | 🟢  | 🟢  | 🟢  | 🟡  | 🟢  |
| **P3** | 🟢  | 🟢  | 🟢  |  — | 🟢  | 🟢  | 🟡  | 🟢  |
| **P4** | 🟢  | 🟢* | 🟢  | 🟢  |  — | 🟢  | 🟡  | 🟢  |
| **P5** | 🟢  | 🟢  | 🟢  | 🟢  | 🟢  |  — | 🟢  | 🟢  |
| **P6** | 🟢  | 🟡  | 🟡  | 🟡  | 🟡  | 🟢  |  — | 🟡  |
| **P7** | 🟢  | 🟡  | 🟢  | 🟢  | 🟢  | 🟢  | 🟡  |  — |

🟢 = no conflict · 🟢\* = resolved via file-ownership contract (P4 owns `/api/notifications`) · 🟡 = soft (order matters for measurement, no file collision)

---

## Success definition (end of plan)

After all 7 phases, running `./scripts/bench-cold.sh delta-livestock` from Cape Town produces:

```
/login                          FCP  < 1.0 s   JS   <  90 KB brotli
/delta-livestock/home           TTFB < 0.6 s
/delta-livestock/dashboard      TTFB < 0.8 s   LCP  <  1.8 s
/delta-livestock/logger         TTFB < 0.6 s   cold API fan-out ≤ 4 calls
/delta-livestock/admin/animals  HTML < 100 KB  TTI  <  2.5 s
```

A month later, the same bench must produce the same numbers ± 10 %. If it regresses, the LHCI budget from Phase 1 fails the PR — the contract that prevents the 2–4 week regression cycle.

---

## Out of scope (intentionally deferred)

- SSR streaming / React Server Components progressive rendering — possible Phase 8 once the floor is low enough for streaming to matter.
- Image optimization (Mapbox tiles, hero photos) — not on the critical path per the audit.
- Offline queue compaction — covered by existing Phase K/L work.
- Einstein RAG latency — separate workstream, different bottleneck.
