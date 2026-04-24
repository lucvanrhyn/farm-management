# Frankfurt Region Cutover Runbook (Phase E / P7)

**Goal:** eliminate the Cape Town → iad1 → Tokyo triple-hop that sets a ~600 ms
floor on every authenticated request. Target end-state: Vercel fn in `fra1`
(Frankfurt) + per-farm Turso DB in `aws-eu-central-1` (Frankfurt). Expected cold
p95 dashboard drop: 200–400 ms on top of `bench-results/*post-wave2-*` baselines.

This runbook is the *human-executed* counterpart to the Phase E code that
lands on `perf/frankfurt-region`. The code is necessary but not sufficient —
flipping `vercel.json` alone without migrating the DBs first would make things
**worse** (Frankfurt → Tokyo is further than US-East → Tokyo).

---

## Pre-flight checklist

Run these before kicking off the cutover. Any red flag aborts the run.

- [ ] Wave-2 A/B/D has soaked clean on `main` for ≥24 h (cutoff ≥ 2026-04-25 08:00 UTC).
- [ ] Current `bench-results/` contains a fresh `post-wave2-*` baseline for dashboard, admin-animals, logger (re-run if older than 24 h).
- [ ] `TURSO_API_TOKEN` + `TURSO_ORG` exported in shell (needed by `createTursoDatabase`).
- [ ] `META_TURSO_URL` + `META_TURSO_AUTH_TOKEN` exported (meta-DB swap).
- [ ] `turso` CLI installed and authenticated (`turso auth whoami` returns your user).
- [ ] Meta-DB migration applied:
  `pnpm tsx scripts/migrate-meta-legacy-turso-cols.ts`
- [ ] All tests pass on `perf/frankfurt-region`:
  `pnpm vitest run` — expect green, including new `__tests__/region/**`.
- [ ] PR for the branch is **open but not merged** — `vercel.json` flipping to
  `regions: ["fra1"]` must not land on `main` until after farm DBs are migrated.
- [ ] Operator has a running Vercel preview deployment from `perf/frankfurt-region`
  to smoke-test against during each farm's verification step.

---

## Cutover sequence (per farm)

Migrate one farm at a time. Start with `trio-b-boerdery` (largest tenant), then
`basson-boerdery`, then any remaining.

Each farm cutover is its own atomic unit with independent rollback. **Do not
batch-swap multiple farms in parallel** — a partial failure would leave the
meta DB in an ambiguous state.

### 1. Dry-run the migration

```bash
pnpm tsx scripts/migrate-farm-to-frankfurt.ts --slug <slug> --dry-run
```

Expected: prints the planned actions and stops before any destructive step.
Verify the source DB name resolves correctly from `turso_url`.

### 2. Announce maintenance window (if tenant has active users)

Post the maintenance banner in-app (reach for the Phase-J banner component) or
at minimum update status page. Expected window: **5 minutes per tenant**;
largest (Trio B at 874 animals, ~37 tables) has historically taken ~90s wall.

### 3. Run the migration

```bash
pnpm tsx scripts/migrate-farm-to-frankfurt.ts --slug <slug>
```

The script will:
1. `turso db shell <source> .dump > <tmp>/<slug>.sql`
2. `createTursoDatabase("<slug>-fra", { location: "fra" })`
3. `turso db shell <slug>-fra < <tmp>/<slug>.sql` (restore)
4. Row-count parity check across every non-`sqlite_*`, non-`_migrations*` table.
   **Aborts non-zero if any table diverges** — leaves target DB intact for
   inspection.
5. `UPDATE farms SET legacy_turso_url = turso_url, ..., turso_url = <new>, ...`
   atomically in meta DB. The old URL lives in `legacy_turso_url` for rollback.

### 4. Evict in-flight caches

Vercel Lambdas hold a 10-min farm-creds cache (`lib/farm-creds-cache.ts`).
Bounce the deployment so every Lambda re-reads meta DB:

```bash
vercel redeploy <prod-deployment-id>
```

Or push an empty commit to `main` if a redeploy isn't desired.

### 5. Smoke test

From the operator's machine:

```bash
# Hit the preview/prod dashboard cold (fresh browser profile, cookies cleared):
curl -sS -H "Cookie: $BENCH_COOKIE" \
  -w 'TTFB=%{time_starttransfer}s\n' \
  https://<deployment>.vercel.app/<slug>/dashboard -o /dev/null

# Expect TTFB to have dropped if this farm's DB + fn are both in fra.
# Then run the bench harness with a fresh label:
pnpm tsx scripts/bench-prod-cold.ts \
  --url https://<deployment>.vercel.app/<slug>/dashboard \
  --iterations 5 \
  --label post-frankfurt-<slug>
```

The regression detector in `bench-prod-cold.ts` will auto-compare against the
most recent `post-wave2-*` baseline for the same URL. Accept only if p95
**improved** — if it regressed, roll back (step 7).

### 6. Verify Server-Timing `db-region` label

Open devtools on the preview deployment and load the dashboard. Response
headers should contain:

```
Server-Timing: db-region-fra;dur=1, session;dur=N, prisma-acquire;dur=N, total;dur=N
```

If `db-region-nrt` or `db-region-unknown` appears, something is wrong:
- `nrt` → the meta-DB swap didn't take effect / the Lambda still holds stale creds.
- `unknown` → `creds.tursoUrl` doesn't match the expected `.aws-*.turso.io` pattern.

### 7. Rollback (if needed)

```bash
pnpm tsx scripts/migrate-farm-to-frankfurt.ts --slug <slug> --rollback
```

Flips the meta-DB pointer back to `legacy_turso_url`. The old Turso DB is
**never deleted** by the migration — it remains authoritative state until
Phase 8 (retirement) below. Re-deploy to evict creds cache.

---

## After all farms are migrated

### 8. Verify globally

```bash
pnpm tsx scripts/verify-farm-regions.ts
# Expect: ✓ all N farms in region "fra"
```

### 9. Flip Vercel region

**Only after step 8 passes.** Merge `perf/frankfurt-region` to `main` — the
`vercel.json` change is the one line that moves every function to `fra1`:

```json
{ "regions": ["fra1"], "crons": [...] }
```

Wait for the production deployment to finish. Confirm `x-vercel-id` header
now starts with `fra1::`:

```bash
curl -sI https://farm-management-lilac.vercel.app/login | grep -i x-vercel-id
# Expected: x-vercel-id: cpt1::fra1::... (Cape Town edge, Frankfurt fn)
```

### 10. Capture the win

```bash
pnpm tsx scripts/bench-prod-cold.ts \
  --url https://farm-management-lilac.vercel.app/trio-b-boerdery/dashboard \
  --iterations 10 \
  --label post-frankfurt
```

Commit the snapshot under `bench-results/` and update `docs/perf/bench-playbook.md`
with the new baseline.

### 11. Enable the region smoke check in CI

Add to `.github/workflows/region-check.yml` (or similar):

```yaml
  - run: pnpm tsx scripts/verify-farm-regions.ts --target fra
```

Schedule daily. Any drift back to `nrt`/`iad` (e.g. a new farm provisioned into
the wrong region) will page.

### 12. Retire legacy DBs

After a **two-week clean soak** (no rollbacks, no drift), delete the legacy DBs:

```bash
turso db destroy <slug>           # for each farm slug that had a legacy DB
```

Then clear the meta-DB rollback columns:

```sql
UPDATE farms SET legacy_turso_url = NULL, legacy_turso_auth_token = NULL;
```

Document the retirement in `memory/ops-incidents.md` with the date and the
resulting perf delta from step 10.

---

## Known gotchas

- **Turso CLI token** is separate from `TURSO_API_TOKEN`. The CLI uses `~/.config/turso/settings.json` (from `turso auth login`). The management API uses the env var. Both must be configured.
- **`.dump` is synchronous** — the source DB is briefly at max read load during step 3.3. For multi-hundred-MB dumps, consider a read-only window first.
- **Embedded replicas are NOT created** by this runbook. The migration is a one-shot copy + pointer swap, not a replica topology change. If we later want geo-redundancy we'd add a separate Phase.
- **Vercel region change is global** — `regions: ["fra1"]` moves *every* function including `/api/inngest`. The daily 05:00 UTC cron continues to run, just from Frankfurt. If Inngest latency to the SA-facing API matters, reconsider; at current scale it doesn't.
- **Inngest Realtime connections** (if we ever add them) are regional; a region flip would force WebSocket re-connects.

---

## Appendix — why not a dual-write in-code pattern?

The initial Phase E brief proposed an app-level dual-write (reads from fra,
writes to both fra + Tokyo during cutover). We discarded that pattern because:

1. Turso's own replica topology already handles read fan-out to nearest replica.
2. Application-level dual-write introduces a consistency window: if the Tokyo
   write succeeds but the fra write fails, the fra replica can serve stale
   reads with no loop-close.
3. A single `.dump` + pointer-swap has one failure mode and one rollback.
   Dual-write has many.
4. Migration downtime per farm is ≤ 2 minutes — acceptable for a tenant count
   in the single digits. The complexity cost of a dual-write ladder would be
   repaid only with hundreds of tenants.

The runbook above trades a brief per-tenant maintenance window for operational
simplicity and a trivially-verifiable rollback.
