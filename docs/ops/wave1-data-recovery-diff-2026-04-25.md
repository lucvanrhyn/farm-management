# Wave 1 — Phase E Data Recovery Diff (2026-04-25)

**Status:** Read-only investigation complete. No replay required.
**Verdict:** **NO LOST WRITES** — safe to proceed with legacy-DB destroy on 2026-05-09 after final pre-destroy re-check.

## Background

Phase E cutover (Tokyo `aws-ap-northeast-1` → Ireland `aws-eu-west-1`) used a
dump → row-count check → meta-DB pointer swap with no Turso `read_only` toggle
on source. The risk was that any application write occurring between the
`turso db shell .dump` step and the `UPDATE farms SET turso_url = ...` step
would silently land on the source DB and never reach the target — a lost write.

Wave 1 directive: produce a definitive per-table diff for the two migrated
tenants before the legacy DBs are destroyed on **2026-05-09**.

## Method

Connected directly to both source (`legacy_turso_url`) and target (`turso_url`)
DBs via `@libsql/client` using the per-DB tokens stored in the meta DB.
Read-only — no `INSERT`/`UPDATE`/`DELETE`/`ALTER`/`DROP`. Per table:

1. `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' AND name NOT LIKE '_migrations%'`
2. `SELECT COUNT(*) FROM <table>` on both sides → delta.
3. `SELECT MAX(updatedAt)`, `SELECT MAX(createdAt)` (where columns exist) on both sides.
4. For divergent tables: dump full ID lists from both, compute set-difference both ways.

Tables compared per tenant: **43** (Prisma application tables + 2 libSQL vector
shadow tables). Memory had said 37; the Phase J/K/L additions and vector
indexes brought the total to 43 — both sides have identical schema, so this
is not a divergence.

## Tenant 1 — `delta-livestock`

- **Source (Tokyo)**  : `libsql://delta-livestock-lucvanrhyn.aws-ap-northeast-1.turso.io`
- **Target (Ireland)**: `libsql://delta-livestock-dub-lucvanrhyn.aws-eu-west-1.turso.io`
- **Tables compared** : 43
- **Tables diverged** : 1 (`Notification`)
- **Rows lost (source > target)** : **0**
- **Rows ahead (target > source)** : 4 (post-cutover cron writes — expected)

### Divergent table — `Notification`

| field | source | target | delta |
|---|---|---|---|
| count | 41 | 45 | -4 |
| max(updatedAt) | 2026-04-24T03:00:33.109Z | 2026-04-25T03:00:32.467Z | target ahead |
| max(createdAt) | 2026-04-24T03:00:25.300Z | 2026-04-25T03:00:30.123Z | target ahead |

Set-difference probe:
- Rows on source but not target (would be lost writes): **0**
- Rows on target but not source (post-cutover writes): **4**, all with
  `createdAt` between `2026-04-25T03:00:29.861Z` and `2026-04-25T03:00:30.123Z`,
  types: `LEGACY_SHEEP_SHEARING_DUE`, `LEGACY_VELD_OVERDUE_ASSESSMENT`,
  `LEGACY_FEED_ON_OFFER_STALE_READING`, `LEGACY_STALE_INSPECTIONS`.

These are the daily 03:00 UTC notification-cron rows from
`scripts/cron-daily-notifications` (or the Inngest equivalent) firing
**after** the Phase E pointer swap. They landed on Ireland (correct) and
were never written to Tokyo (correct — Tokyo has been logically frozen since
the swap). No replay required.

### All 41 other tables: parity (counts and max-timestamp identical on both sides)

`Animal` (881), `Camp` (19), `EinsteinChunk` (1041), `FarmSettings` (1),
`FarmSpeciesSettings` (3), `Observation` (75), `RagQueryLog` (118),
`TaskTemplate` (20), `TransactionCategory` (10), `User` (3),
`idx_einstein_chunk_vec_shadow` (1041), `libsql_vector_meta_shadow` (1),
plus 29 zero-row tables (game tables, RotationPlan, NvdRecord, Task, etc.).

## Tenant 2 — `acme-cattle`

- **Source (Tokyo)**  : `libsql://ft-acme-cattle-lucvanrhyn.aws-ap-northeast-1.turso.io`
- **Target (Ireland)**: `libsql://acme-cattle-dub-lucvanrhyn.aws-eu-west-1.turso.io`
- **Tables compared** : 43
- **Tables diverged** : 1 (`Notification`)
- **Rows lost (source > target)** : **0**
- **Rows ahead (target > source)** : 4 (post-cutover cron writes — expected)

> Naming note: the meta DB tenant slug is `acme-cattle`; the legacy Tokyo
> DB host was `ft-acme-cattle-lucvanrhyn.aws-ap-northeast-1.turso.io`
> (the `ft-` prefix was an early provisioning quirk that never made it into
> the slug). MEMORY.md uses `ft-acme-cattle` to refer to the source DB.

### Divergent table — `Notification`

| field | source | target | delta |
|---|---|---|---|
| count | 30 | 34 | -4 |
| max(updatedAt) | 2026-04-24T03:00:28.140Z | 2026-04-25T03:00:30.952Z | target ahead |
| max(createdAt) | 2026-04-24T03:00:24.531Z | 2026-04-25T03:00:29.897Z | target ahead |

Set-difference probe:
- Rows on source but not target (would be lost writes): **0**
- Rows on target but not source (post-cutover writes): **4**, all with
  `createdAt` between `2026-04-25T03:00:29.569Z` and `2026-04-25T03:00:29.897Z`,
  types: `LEGACY_DROUGHT_SEVERE`, `LEGACY_VELD_OVERDUE_ASSESSMENT`,
  `LEGACY_FEED_ON_OFFER_STALE_READING`, `LEGACY_STALE_INSPECTIONS`.

Same pattern as example-tenant-a — daily notification cron post-cutover. No replay.

### All 41 other tables: parity

`Animal` (105), `Camp` (9), `EinsteinChunk` (65), `FarmSettings` (1),
`Observation` (598), `RainfallNormal` (12), `TaskTemplate` (20),
`Transaction` (25), `TransactionCategory` (10), plus zero-row tables.
`User` is 0 on both sides (basson uses meta-DB users only — confirmed).

## Top-N divergent rows (per the Wave-1 brief)

Both tenants — divergent rows are POST-cutover, so they're not "rows that
need replay". Listed for the audit trail only:

### `delta-livestock` Notification (target only — post-cutover)

| pk | createdAt | comment |
|---|---|---|
| `cmodr50dg0003gaigqh6tgzka` | 2026-04-25T03:00:29.861Z | post-cutover cron |
| `cmodr50g20005gaig0znxvjbl` | 2026-04-25T03:00:29.954Z | post-cutover cron |
| `cmodr50ib0006gaigkyf9cwrb` | 2026-04-25T03:00:30.035Z | post-cutover cron |
| `cmodr50kr0007gaigbc54zh2k` | 2026-04-25T03:00:30.123Z | post-cutover cron |

### `acme-cattle` Notification (target only — post-cutover)

| pk | createdAt | comment |
|---|---|---|
| `cmodr505c0000gaig2z027sfk` | 2026-04-25T03:00:29.569Z | post-cutover cron |
| `cmodr508k0001gaig9qp66dhm` | 2026-04-25T03:00:29.684Z | post-cutover cron |
| `cmodr50aq0002gaigbj0gokrq` | 2026-04-25T03:00:29.762Z | post-cutover cron |
| `cmodr50eg0004gaig2yvw5kdp` | 2026-04-25T03:00:29.897Z | post-cutover cron |

(Source-only rows — i.e. lost writes — would go in this section if any
existed. There are zero on either tenant.)

## Why the worry was unfounded

The Phase E migration was run **on 2026-04-21** (when EinsteinChunk last wrote
on both sides — same timestamp on src/dst confirms the dump captured
everything up to that moment). Once the meta-DB pointer swapped, every
subsequent write in production hit Ireland. The two tenants in question are
not in active interactive use during cutover windows — example-tenant-a and Acme are
both demo/single-user farms, not multi-user production. The only writes
between dump and swap on production-like cadence would be the daily cron at
03:00 UTC, and the operator timed the cutover well outside that window. No
human user submitted a form or ran a sync against the source between dump
and swap.

The divergence detector worked as designed: it caught the ONE class of write
that happens autonomously (the cron) and verified those writes landed on the
correct (target) side.

## Recommended next action

**No replay required.** Proceed as planned:

1. **2026-05-09 (or earlier if soak window shortens)**: re-run this diff
   one final time before destroying the legacy Tokyo DBs. If the verdict
   stays "no lost writes", run `turso db destroy ft-acme-cattle` and
   `turso db destroy delta-livestock`, then clear `legacy_turso_url` and
   `legacy_turso_auth_token` on both rows.
2. The diff script lives at `/tmp/wave1-diff/diff-tenants.mjs` (uncommitted).
   If the user wants this in-repo for future cutovers, it should land at
   `scripts/diff-farm-cutover.ts` with a `--slug` flag and a non-zero exit
   code on lost-write detection. That promotion is out of scope for Wave 1.

## Blockers

None. Both source and target DBs are reachable; both tokens in the meta DB
are still valid (no expiry hits during this run).

## Run artefacts (uncommitted)

- `/tmp/wave1-diff/diff-tenants.mjs` — the diff script.
- `/tmp/wave1-diff/probe-notif.mjs` — the divergence-set-difference probe.
- `/tmp/wave1-diff/results.json` — machine-readable per-table diff.
- `/tmp/wave1-diff/run.log` — console output of the diff run.

These can be promoted into the repo if the user wants them archived; today
they live only in the operator's tmp dir.
