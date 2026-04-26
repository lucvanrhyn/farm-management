# Meta DB Cutover Runbook (Tokyo → Ireland)

**Status:** Drafted 2026-04-26. Cutover not yet scheduled.
**Goal:** move the FarmTrack meta DB from `aws-ap-northeast-1` (Tokyo) to
`aws-eu-west-1` (Ireland, short code `dub`) so that every authenticated
request — login, email verification, tier gates, farm lookups — completes a
round-trip from the Frankfurt Lambda (`fra1`) without crossing the Pacific.

**Why this is a separate cutover from Phase E:** Phase E moved per-farm
data to Ireland. The meta DB stayed in Tokyo because:

1. The meta DB is a *single* DB hit by every login. Migrating it requires
   either tolerating a brief auth window or coordinating with a
   `NEXTAUTH_SECRET` rotation (which already invalidates sessions).
2. The Phase E migration script (now retired) didn't have a write fence —
   running it against the meta DB would risk losing a signup write that
   landed between dump and pointer-swap.
3. Wave 4 close-out leaves a natural moment: server logs are now structured
   (Wave 4 G.4 + the round-2 hotfix), so any auth blip during the cutover
   surfaces in logs rather than getting swallowed.

**Estimated downtime:** ~30–60 seconds of auth unavailability (login + farm
switch + tier-gate routes return 503 / 401). Reads from per-farm DBs
continue serving; only meta-DB-touching routes are affected.

---

## Pre-flight checklist

Run all of these in the day **before** the cutover. Any red flag aborts.

- [ ] Confirm Wave 4 + round-2 hotfixes have soaked clean on `main` for ≥48 h
  (cutoff: at least 2 days after `1b1b3da` was pushed, i.e. ≥ 2026-04-27 22:00 SAST).
- [ ] Confirm zero auth-related Vercel runtime errors in the last 24 h:
  `vercel logs --since 24h | grep -i 'meta\|withMetaDb\|isMetaAuthError'`
- [ ] Verify current meta DB is healthy:
  ```
  turso db shell farmtrack-meta-lucvanrhyn 'SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM farms; SELECT COUNT(*) FROM farm_users;'
  ```
  Note the row counts for the post-cutover diff.
- [ ] Capture **current** Vercel env values (so rollback is one command):
  ```
  vercel env pull .env.preflight-meta --environment=production
  grep ^META_ .env.preflight-meta > .meta-rollback.env
  ```
  Save `.meta-rollback.env` somewhere outside the repo (NOT committed).
- [ ] Pick window: low-traffic Sunday 02:00–02:30 SAST (per Inngest logs;
  audit confirms <2 logins/min in that window historically).
- [ ] Communicate the window to active users (none currently — single-tenant
  pre-launch). For pre-launch this is a no-op; for post-launch, post a
  banner via the (yet-to-be-built) maintenance flag or skip if traffic is
  truly idle.
- [ ] `turso` CLI authenticated (`turso auth whoami` returns `lucvanrhyn`).
- [ ] `vercel` CLI authenticated and pointing at `farm-management` project.

## Cutover steps

Total wall-clock budget: 30 minutes including verification.

### 1. Create the new Ireland meta DB (T+0)

```
turso db create farmtrack-meta-dub-lucvanrhyn --location dub
```

Verify creation:

```
turso db show farmtrack-meta-dub-lucvanrhyn
```

Note the URL (`libsql://farmtrack-meta-dub-lucvanrhyn-lucvanrhyn.aws-eu-west-1.turso.io`)
and create an auth token with no expiration (per `ops-incidents.md`):

```
turso db tokens create farmtrack-meta-dub-lucvanrhyn --expiration none
```

Save the URL + token to `.meta-cutover.env` (NOT committed). These become
the new `META_TURSO_URL` and `META_TURSO_AUTH_TOKEN`.

### 2. Stop signups + freeze meta-DB writes (T+5)

The meta DB has three write paths in production:
- Email verification token writes (`UPDATE users SET email_verified=1, ...`)
- Signup (`INSERT INTO users`, `INSERT INTO farms`, `INSERT INTO farm_users`)
- Token rotation (`UPDATE farms SET turso_auth_token=...`)

For pre-launch (no real users), signup traffic is effectively zero.
Skip the explicit freeze. Otherwise, return 503 from auth/signup routes
via a temporary feature flag (no such flag exists today — would need to
add one before cutover, see "Open items" below).

### 3. Dump source → restore target (T+5–T+10)

```
turso db shell farmtrack-meta-lucvanrhyn .dump > /tmp/meta-cutover.sql
turso db shell farmtrack-meta-dub-lucvanrhyn < /tmp/meta-cutover.sql
```

Expected size: a few KB (small registry — no vector tables, no large
denormalized data). Should complete in seconds.

### 4. Verify row-count parity (T+10)

```
for tbl in users farms farm_users; do
  src=$(turso db shell farmtrack-meta-lucvanrhyn "SELECT COUNT(*) FROM $tbl;" | tail -1)
  dst=$(turso db shell farmtrack-meta-dub-lucvanrhyn "SELECT COUNT(*) FROM $tbl;" | tail -1)
  echo "$tbl: src=$src dst=$dst"
done
```

All three must match exactly. If not, **abort and rollback** (skip step 5).
Dump again with `.dump --schema-only` and `.dump --data-only` separately to
isolate the divergence.

### 5. Swap Vercel env vars (T+12)

Update both Production and Preview together so any downstream preview
deploys see the new meta:

```
echo "$NEW_META_URL" | vercel env add META_TURSO_URL production --sensitive --force
echo "$NEW_META_TOKEN" | vercel env add META_TURSO_AUTH_TOKEN production --sensitive --force
echo "$NEW_META_URL" | vercel env add META_TURSO_URL preview --sensitive --force
echo "$NEW_META_TOKEN" | vercel env add META_TURSO_AUTH_TOKEN preview --sensitive --force
```

The `--sensitive` flag keeps the values write-only on Vercel (cannot be
pulled back into local files later) — security hygiene.

### 6. Trigger production redeploy (T+13)

```
vercel --prod
```

Wait for the deployment to reach Ready (~3 min). The new Lambdas pick up
the rotated env on cold start.

### 7. Coordinate NEXTAUTH_SECRET rotation if not already done (T+13, optional)

If a fresh secret hasn't been rotated since the last login event, this is
the moment — invalidating sessions covers any in-flight requests that
might have been mid-meta-call during the swap. Wave 1 W1b already rotated
on 2026-04-25; if no further rotations have happened, skip.

### 8. Smoke test (T+16)

In the Vercel preview URL of the new deploy:

- [ ] Hit `/login`, log in with a known user, confirm 200.
- [ ] Hit `/farms`, confirm farm list shows.
- [ ] Hit `/<farmSlug>/dashboard`, confirm farm-specific data loads (this
  exercises both the meta DB path → `farms.turso_url` lookup → and the
  per-farm DB path).
- [ ] Hit `/api/farm`, confirm `{ farmName, breed, animalCount, campCount }`
  responds.
- [ ] Trigger an email-verification flow if signups are open: register a
  test account, confirm verification token is written.

If any smoke test fails, **rollback** (step 11).

### 9. Watch logs for 30 minutes (T+20)

```
vercel logs --follow --filter='meta\|withMetaDb\|auth'
```

Zero `isMetaAuthError` retries. Zero 503s. If anything looks off in the
soak window, rollback.

### 10. Confirm cutover and update memory (T+50)

- [ ] Update `MEMORY.md` and `audit-waves-historical-2026-04-25.md`:
  remove "META_TURSO_URL stays in Tokyo" entries, add "Meta DB on Ireland
  since YYYY-MM-DD".
- [ ] Update `.env.example`: change the `META_TURSO_URL` example value
  from `aws-ap-northeast-1` to `aws-eu-west-1`.
- [ ] Schedule old meta DB destroy for **30 days** from now (soak window
  matches the per-farm pattern from Phase E). DO NOT destroy immediately —
  if a regression surfaces in the soak, rolling back is one env swap.

## Rollback

If any verification step fails:

```
vercel env rm META_TURSO_URL production --yes
vercel env rm META_TURSO_AUTH_TOKEN production --yes
echo "$(grep ^META_TURSO_URL .meta-rollback.env | cut -d= -f2)" | vercel env add META_TURSO_URL production --sensitive --force
echo "$(grep ^META_TURSO_AUTH_TOKEN .meta-rollback.env | cut -d= -f2)" | vercel env add META_TURSO_AUTH_TOKEN production --sensitive --force
vercel --prod
```

The new (broken) Ireland meta DB stays around for forensics; original
Tokyo meta DB resumes traffic on next cold start.

## 30-day post-cutover destroy

Once the soak window closes without incident:

```
turso db destroy farmtrack-meta-lucvanrhyn --yes
```

Then update `MEMORY.md` and remove the rollback escape-hatch reference
from this runbook.

## Open items / known risks

- **No maintenance-mode flag** today. Pre-launch this is a no-op; any
  production cutover after launch should land a `MAINTENANCE_MODE` env-var
  → middleware check that returns a maintenance page for non-static
  routes. Add this as a separate task before launch.
- **No automated diff for meta DB**. The `scripts/diff-farm-cutover.ts`
  promotion (post-wave follow-up #1) is for per-farm DBs. Meta DB diff
  is just three `COUNT(*)` queries (step 4 here) — small enough to inline.
- **`legacy_turso_url` columns** on `farms` rows are still populated for
  the two Phase-E-migrated tenants until the 2026-05-09 destroy. The
  cutover dump carries those columns over to the new meta DB unchanged;
  no special handling needed.
