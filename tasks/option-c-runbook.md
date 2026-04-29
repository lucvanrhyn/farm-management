# Option C — Turso Per-Branch DB Clone: Operator Runbook

## 1. What this is

Option C provisions an isolated Turso database clone for every Git feature branch. When a Vercel preview deployment builds, the `vercel-prebuild.ts` script clones the source (production) DB into a branch-specific DB, injects its URL and auth token as Vercel environment variables, and the preview runs entirely against that clone. Source and preview data are fully isolated: writes to the clone never reach production. When a branch is promoted to main, the production DB receives the pending migrations, and the clone can be destroyed. All clone metadata (URL, token, timestamps) is stored in the shared meta-DB under the `branch_db_clones` table.

---

## 2. Prerequisites

**Required environment variables:**

| Variable | Description |
|---|---|
| `META_TURSO_URL` | libsql URL of the meta-DB (e.g. `libsql://farmtrack-meta.turso.io`) |
| `META_TURSO_AUTH_TOKEN` | Auth token for the meta-DB (use `--expiration none` tokens) |
| `TURSO_API_TOKEN` | Turso platform API token — used by the `turso` CLI for DB management |
| `BRANCH_CLONE_SOURCE_DB` | Name of the Turso DB to clone from (e.g. `basson-boerdery`) |

**Additional variables required only for `promote`:**

| Variable | Description |
|---|---|
| `PROD_TENANT_DB_URL` | libsql URL of the production tenant DB to run migrations against |
| `PROD_TENANT_DB_AUTH_TOKEN` | Auth token for the production tenant DB |

**Tools:**

- `turso` CLI installed and on `PATH`. Verify: `turso --version`.
- `pnpm` + `tsx` available (installed via `pnpm install`).
- Meta-DB migrated (see section 3).

---

## 3. First-time setup

Run the meta-DB migration to create the `branch_db_clones` table:

```bash
pnpm tsx scripts/migrate-meta-branch-clones.ts
```

This is idempotent — running it a second time is a no-op. Verify the table exists and the script is working:

```bash
pnpm ops:daily-summary
```

Expected output with an empty table:

```
Option C — daily ops summary (UTC: 2026-04-28T12:00:00.000Z)
Active branch clones: 0
```

---

## 4. Cloning a branch manually

```bash
pnpm ops:clone-branch <branchName> --source <sourceDbName>
```

Example:

```bash
pnpm ops:clone-branch wave/22-layout-shell --source basson-boerdery
```

Stdout on success (JSON):

```json
{
  "branchName": "wave/22-layout-shell",
  "tursoDbName": "ft-clone-wave-22-layout-shell-a1b2c3",
  "tursoDbUrl": "libsql://ft-clone-wave-22-layout-shell-a1b2c3.turso.io",
  "tursoAuthToken": "<non-expiring token>",
  "alreadyExisted": false
}
```

If a clone already exists for that branch name, `alreadyExisted: true` is returned and no CLI calls are made (idempotent — safe to re-run).

Optional flags:

| Flag | Default | Description |
|---|---|---|
| `--source <dbName>` | (required) | Turso DB to clone from |
| `--prefix <prefix>` | `ft-clone` | Prefix for the clone DB name |

---

## 5. Destroying a branch clone

```bash
pnpm ops:destroy-branch <branchName>
```

Example:

```bash
pnpm ops:destroy-branch wave/22-layout-shell
```

Stdout on success (JSON):

```json
{
  "branchName": "wave/22-layout-shell",
  "tursoDestroyed": true,
  "metaRowDeleted": true
}
```

**Recovery flag — `--skip-turso`:**

Use this when the Turso DB was already manually destroyed (or never created) and only the meta row needs cleaning:

```bash
pnpm ops:destroy-branch wave/22-layout-shell --skip-turso
```

This deletes only the meta-DB row without calling `turso db destroy`. The resulting JSON will show `"tursoDestroyed": false`.

If no meta row exists for the branch, the command returns `false/false` and exits 0 (idempotent).

---

## 6. Promoting a branch to prod

**Before running promote, set these two env vars to the production tenant DB — NOT the meta-DB:**

```bash
export PROD_TENANT_DB_URL="libsql://basson-boerdery.turso.io"
export PROD_TENANT_DB_AUTH_TOKEN="<non-expiring prod token>"
```

Then promote:

```bash
pnpm ops:promote-branch <branchName>
```

Example:

```bash
pnpm ops:promote-branch wave/22-layout-shell
```

**What promote does:**

1. Looks up the branch clone record in the meta-DB (must exist — clone first if not).
2. Checks the soak gate: the clone must have existed for at least 1 hour since creation.
3. Runs all pending migrations from `migrations/` against `PROD_TENANT_DB_URL` (using `lib/migrator.ts`).
4. Marks the meta row promoted with timestamps.

**Soak gate flags:**

| Flag | Description |
|---|---|
| `--min-soak-hours <n>` | Override minimum soak (default: 1). E.g. `--min-soak-hours 2`. |
| `--force-skip-soak` | Bypass the soak gate entirely. **Only for emergency hotfixes.** Never use for routine promotions — skipping soak means migrations have not been validated on a clone that has soaked under real-ish traffic patterns. |

**Important:** `PROD_TENANT_DB_URL` + `PROD_TENANT_DB_AUTH_TOKEN` must point to the prod tenant DB you are migrating, not the meta-DB. The CLI runs `lib/migrator.ts` against the DB at that URL.

If promote fails halfway, the meta row is NOT marked promoted — rerun once the underlying issue is fixed.

---

## 7. Vercel integration

`scripts/vercel-prebuild.ts` runs automatically during every Vercel preview build (it is the `prebuild` step in the Vercel build command). It provisions the clone and writes two env vars into the build environment:

- `TURSO_DATABASE_URL` — set to the clone's libsql URL
- `TURSO_AUTH_TOKEN` — set to the clone's non-expiring auth token

**Required Vercel env vars (set in the Vercel dashboard under "Environment Variables"):**

| Variable | Environments |
|---|---|
| `META_TURSO_URL` | Preview |
| `META_TURSO_AUTH_TOKEN` | Preview |
| `TURSO_API_TOKEN` | Preview |
| `BRANCH_CLONE_SOURCE_DB` | Preview |

**Production safety guarantee:** `vercel-prebuild.ts` checks `VERCEL_ENV` before doing anything. If `VERCEL_ENV === 'production'`, it exits immediately without cloning, without writing env vars, and without touching any DB. Production deployments always use the existing `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` set directly in Vercel.

For non-preview, non-production environments (e.g. `development`), the script is also a no-op.

---

## 8. Daily monitoring

```bash
pnpm ops:daily-summary
```

Example output:

```
Option C — daily ops summary (UTC: 2026-04-28T12:00:00Z)
Active branch clones: 4

  branch                            age      promoted     status
  ────────────────────────────────  ───────  ───────────  ──────
  wave/19-option-c                  3.2h     —            fresh
  wave/22-layout-shell              48.1h    —            fresh
  wave/24-tenant-isolation          172.0h   2026-04-26   STALE
  feat-diff-cutover-script          720.0h   —            STALE

Stale clones (>7d): 2
Recommend destroying or refreshing stale clones to reduce Turso quota usage.
```

**Column meanings:**

| Column | Meaning |
|---|---|
| `branch` | Git branch name |
| `age` | Hours since the clone was created |
| `promoted` | Date of last promotion to prod, or `—` if never promoted |
| `status` | `fresh` = within 7 days; `STALE` = older than 7 days |

**Action thresholds:**

- Any branch with `STALE` status (age > 168h / 7 days) should be investigated.
- If the branch PR is merged and the clone was promoted: destroy the clone with `pnpm ops:destroy-branch <branchName>`.
- If the branch is still active but the clone is stale (preview is out of date): destroy the old clone and re-clone with `pnpm ops:clone-branch <branchName> --source <sourceDbName>` to refresh the snapshot.
- A clone listed as `STALE` but promoted is safe to destroy immediately.

---

## 9. Failure recovery

**If clone fails mid-flight (e.g. turso CLI crashes after DB creation but before meta-DB write):**

The next `pnpm ops:clone-branch` call for the same branch will attempt to create a new Turso DB under a different name (a fresh slug). The orphaned Turso DB (if created) can be destroyed manually via `turso db destroy <db-name> --yes`. The meta-DB will have no record of the failed clone, so no cleanup is needed there.

**If meta row is orphaned (meta-DB says clone exists but `turso db show <name>` fails):**

Use the `--skip-turso` flag to clean up only the meta row:

```bash
pnpm ops:destroy-branch <branchName> --skip-turso
```

**If promote fails halfway (migrations error):**

The meta row is NOT marked promoted — `last_promoted_at` stays null. Fix the migration failure (check the error output), then rerun:

```bash
pnpm ops:promote-branch <branchName>
```

The migrator applies only pending (not yet applied) migrations, so reruns are idempotent.

**If `pnpm ops:daily-summary` errors with "META_TURSO_URL not set":**

The script requires `META_TURSO_URL` and `META_TURSO_AUTH_TOKEN` in the environment. Either:
- Run via `dotenv-cli -e .env.local -- pnpm ops:daily-summary`, or
- Export the vars inline: `META_TURSO_URL=... META_TURSO_AUTH_TOKEN=... pnpm ops:daily-summary`

---

## 10. Cost notes

**Turso free tier limits (as of 2026-04):**

- 500 databases per organization
- 1 GB storage per database
- 1 billion row reads / month
- 25 million row writes / month

**Option C cost considerations:**

- Each clone is one Turso database. On the free tier, keeping >500 active branches simultaneously would hit the DB limit — extremely unlikely in practice.
- Stale clones (>7 days) consume a DB slot without contributing value. The daily summary flags these.
- Clone creation is fast (seconds) and has no separate cost — it's just a DB copy within the same organization.
- Auth tokens created with `--expiration none` never expire. Destroying the clone DB invalidates the token automatically (the DB no longer exists).

**Integration test cost:**

Running `OPTION_C_INTEGRATION=1 pnpm vitest run __tests__/integration/option-c-roundtrip.test.ts` creates 1 Turso DB and destroys it in the same run. On the free tier this is effectively free (1 DB for ~30 seconds). Do NOT run this in a CI loop on every commit — it is for manual smoke testing only. The test is skipped by default in all CI runs.

**Monitoring quota:**

- Check current DB count: `turso db list | wc -l`
- Check usage: Turso dashboard → Organization → Usage
- If approaching limits, run `pnpm ops:daily-summary` and destroy stale clones.
