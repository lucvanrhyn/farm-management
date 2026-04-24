# Prod Cold-TTFB Bench Playbook

`scripts/bench-prod-cold.ts` is the repeatable way to measure real-world
cold TTFB against production from wherever the operator is sitting (the
user is in Cape Town; prod currently serves from `iad1`). It replaces the
ad-hoc `curl` loops we were running in Slack.

Use it to:

1. Capture baselines at the end of each perf wave (e.g. `post-wave-1`,
   `post-wave-2`).
2. Detect p95 regressions between waves — the script exits non-zero when
   current p95 exceeds `prior p95 * (1 + threshold)` (default threshold
   15%).

---

## Prerequisites

- Authenticated session cookie for the farm tenant you want to bench.
  Cookie extraction is manual (one-time per session) — see next section.
- Node 22 + pnpm installed. The script runs via `pnpm tsx`.

## Extracting the session cookie

1. Log in at <https://farm-management-lilac.vercel.app> as the test user.
2. Open Chrome DevTools → **Application** tab → **Cookies** →
   `https://farm-management-lilac.vercel.app`.
3. Copy the value of `__Secure-next-auth.session-token`.
4. Export it as an env var so it's not on your shell history:

   ```bash
   export BENCH_COOKIE='__Secure-next-auth.session-token=<paste value>'
   ```

   The script reads `BENCH_COOKIE` when `--cookie` is omitted. Do not
   commit this value — it's a full auth session for whichever user you
   logged in as.

**Cookie expiry:** next-auth JWT sessions rotate on activity. If a run
returns 302 redirects or HTML with `<title>Sign in</title>`, re-extract.

---

## Baseline target URLs

Three routes covering the hottest cold paths:

| URL path                            | Why we care |
|-------------------------------------|-------------|
| `/delta-livestock/dashboard`        | Landing after login; renders SSR farm stats. |
| `/delta-livestock/admin/animals`    | Biggest SSR page; pagination + Prisma fan-out. |
| `/delta-livestock/logger`           | Heaviest client bundle; offline-logger shell. |

Run each separately so regressions can be attributed to a specific route.

---

## Cold vs. warm

Our definition of "cold":

- Every request carries a unique `?__bust=<random>` query param so
  Next.js's route cache and Vercel's edge cache cannot serve a warm
  response. The cache-buster is injected automatically.
- `cache-control: no-cache` + `pragma: no-cache` are sent on every
  request.
- The script does **not** warm the upstream between iterations — each
  sample is a fresh Vercel Fn invocation from the user's perspective.

If you want to benchmark a **warm** path (Phase D cache coverage, Phase E
edge cache):

```bash
# Warm pass: hit the URL once, then run the bench against the same
# (non-busted) URL. Use a sentinel label so it doesn't compete with the
# cold baseline for regression detection.
curl -s -H "Cookie: $BENCH_COOKIE" \
  https://farm-management-lilac.vercel.app/delta-livestock/dashboard \
  >/dev/null
pnpm tsx scripts/bench-prod-cold.ts \
  --url https://farm-management-lilac.vercel.app/delta-livestock/dashboard \
  --label warm-dashboard
```

The cold bench is the default; warm runs are occasional.

---

## Running a cold bench

```bash
export BENCH_COOKIE='__Secure-next-auth.session-token=...'

pnpm tsx scripts/bench-prod-cold.ts \
  --url https://farm-management-lilac.vercel.app/delta-livestock/dashboard \
  --iterations 5 \
  --label post-wave-1
```

The script writes `bench-results/<ISO-timestamp>-post-wave-1.json` and
prints progress to stderr. Example tail:

```
iter=0 ttfb=612.3ms total=834.1ms status=200
iter=1 ttfb=589.7ms total=801.4ms status=200
iter=2 ttfb=604.2ms total=820.9ms status=200
iter=3 ttfb=621.0ms total=845.7ms status=200
iter=4 ttfb=597.6ms total=813.3ms status=200
wrote bench-results/2026-04-23T14-05-22-100Z-post-wave-1.json
p95=618.4ms — no prior baseline for label=post-wave-1; snapshot is the new baseline
```

The **first** run for a given label has no prior — the script exits 0
and the snapshot becomes the baseline. Every subsequent run with the
same label compares against the most recently modified matching
snapshot.

---

## Updating the tracked baseline

After each perf wave ships:

```bash
pnpm tsx scripts/bench-prod-cold.ts \
  --url https://farm-management-lilac.vercel.app/delta-livestock/dashboard \
  --label post-wave-2
```

Then commit the new `bench-results/<stamp>-post-wave-2.json` so the next
engineer's regression check has something to compare against.

**What to track vs. ignore:**

- **Track (commit):** labelled perf-wave snapshots — `post-wave-1.json`,
  `post-wave-2.json`, `post-frankfurt.json`, etc. These are small
  (~few KB each), human-readable, and the regression harness needs
  them.
- **Ignore:** ad-hoc experimental runs — use `--label <name>.tmp` so
  `.gitignore` excludes them (pattern: `bench-results/*.tmp.json`).

The `.gitignore` rule added alongside this script enforces that split.

---

## Interpreting regression exits

Exit codes:

| Code | Meaning |
|------|---------|
| `0`  | Snapshot written; either no prior baseline or current p95 is within budget. |
| `1`  | Current p95 exceeded `prior p95 * (1 + threshold)`. |
| `2`  | Operator error (bad args, network failure, no `--url`, etc.). |

When you see exit 1:

```
REGRESSION: p95=742.3ms vs prior 612.4ms (21.2% > +15% threshold; budget was 704.3ms)
```

1. **Re-run the bench.** TTFB from Cape Town has a long tail driven by
   transpacific network noise. Five iterations is fine for signal but
   single runs can false-positive. If the second run is green, note it
   in the PR and move on.
2. **If it reproduces,** bisect the suspected commit(s). The snapshot
   JSON captures `gitSha`, so `git log <prior.gitSha>..<current.gitSha>`
   gives you the exact range that moved the needle.
3. **Check `vercelRegion`.** If it changed between runs (e.g. prior was
   `iad1`, current is `cdg1`), a Vercel region migration is probably the
   culprit — intentional during Phase E, noise otherwise.
4. Raise the threshold only if you've confirmed the new floor is
   intentional and you've updated the tracked baseline.

---

## Percentile method

We use **linear-interpolation Weibull plotting position** (R percentile
type 4): `h = p * n`, interpolate between `sorted[floor(h) - 1]` and
`sorted[floor(h)]`. For the canonical test fixture
`[100, 200, …, 1000]` this gives p50 = 500, p95 = 950, p99 = 990.

We picked this over numpy's default (R type 7: `h = p * (n-1)`) because
the Weibull variant gives clean round numbers for the test fixture,
which makes the regression-threshold budget easier to reason about in
code review. The choice is documented in `percentile()`'s docstring in
`scripts/bench-prod-cold.ts`.

## TTFB caveat

Node's `fetch` does NOT expose curl's `time_starttransfer` directly. We
approximate TTFB by timing from `fetch()` call site to the first chunk
yielded by `response.body.getReader().read()`. This is coarser than curl
for two reasons:

1. Node's fetch buffers response headers before surfacing them, so the
   measured TTFB includes a few ms of header-parse time that curl would
   attribute to transfer.
2. The runtime may coalesce small TCP reads into a single chunk,
   shifting a handful of ms between `ttfb` and `total`.

Empirically this adds ~5-15 ms of noise relative to `curl
-w "%{time_starttransfer}"` on the same URL. **Do not compare
`bench-prod-cold` numbers with curl numbers directly** — always compare
runs of this tool against other runs of this tool.
