# Wave 4 A1 — All-tenant promote (CRITICAL)

Codex 2026-05-02 finding (CRITICAL):
> All-tenant migration gap — promote workflow only migrates `PROD_TENANT_DB_URL`. Second-tenant-onwards never gets schema.

## Root cause

`lib/ops/branch-clone.ts::_defaultRunProdMigration()` reads exactly two env vars
(`PROD_TENANT_DB_URL` + `PROD_TENANT_DB_AUTH_TOKEN`) and runs `runMigrations`
against that single libSQL endpoint. Any tenant beyond Acme Cattle is
silently skipped at promote time, so future tenants would deploy app code that
references columns/tables their per-farm DB does not have.

The right pattern already exists in `scripts/migrate.ts`:
```
const slugs = await getAllFarmSlugs();
for (const slug of slugs) {
  const creds = await getFarmCreds(slug);
  if (!creds) { warn + continue; }
  ...runMigrations against per-tenant client...
}
```

## Plan

- [x] Read `lib/ops/branch-clone.ts`, `scripts/migrate.ts`, `lib/migrator.ts`,
      `lib/meta-db.ts`, `__tests__/lib/ops/branch-clone.test.ts`,
      `.github/workflows/post-merge-promote.yml`, `scripts/branch-clone.ts`,
      and `__tests__/scripts/branch-clone-cli.test.ts`.
- [x] Confirm baseline tests green (36/36).
- [x] TDD red: add a failing test in `__tests__/lib/ops/branch-clone.test.ts`
      that asserts the default migration runner enumerates ≥2 tenants from the
      meta-DB and runs migrations against each, and that one tenant's failure
      causes the whole promote to throw (no silent partial success).
- [x] Refactor `_defaultRunProdMigration`:
      - drop `PROD_TENANT_DB_URL` / `PROD_TENANT_DB_AUTH_TOKEN` reads
      - enumerate via `getAllFarmSlugs()` + `getFarmCreds(slug)`
      - run `runMigrations` per tenant; close client; collect per-tenant results
      - if any tenant throws, throw an aggregate `Error` with all per-tenant
        failures so the post-merge-promote workflow surfaces it
      - aggregate `applied`/`skipped` as the union of per-tenant lists, prefixed
        with the slug for traceability
- [x] Update `.github/workflows/post-merge-promote.yml` — drop the now-unused
      `PROD_TENANT_DB_URL` / `PROD_TENANT_DB_AUTH_TOKEN` env vars (keep
      `META_TURSO_URL` + `META_TURSO_AUTH_TOKEN` + `TURSO_API_TOKEN`).
- [x] Verify locally: `pnpm lint && pnpm tsc && pnpm vitest run __tests__/lib/ops/branch-clone.test.ts && pnpm build`.
- [x] Commit + push + PR.

## Out of scope

- `scripts/migrate.ts` (already correct).
- `lib/meta-db.ts` (already exposes the right helpers).
- Updating `tasks/option-c-runbook.md` / `tasks/promote-runbook.md` — operator
  doc churn, not code-correctness.

## Review (2026-05-02)

- **Refactor landed** as designed. `_defaultRunProdMigration` now delegates to
  the exported `runProdMigrationsAllTenants`, which fans out across every farm
  enumerated from the meta-DB.
- **Per-tenant runner** (`_defaultRunForTenant`) is split out so the new helper
  is fully testable via dependency injection — no real libSQL endpoints in the
  test surface. Mirrors the per-tenant pattern in `scripts/migrate.ts`.
- **Failure isolation:** all tenants attempted before throwing — operator sees
  the full damage report in one aggregate `Error` rather than abort-on-first.
- **Skip semantics** match `scripts/migrate.ts`: orphan slug (no creds row) is
  warned + skipped, not failed, so a half-provisioned tenant doesn't gate the
  promote.
- **Slug-prefixed aggregates** (`applied`/`skipped`) preserve traceability in
  the workflow output without mutating the existing `MigrationResult` shape.
- **Workflow yml** drops only the two now-unused env vars
  (`PROD_TENANT_DB_URL` / `PROD_TENANT_DB_AUTH_TOKEN`); `META_TURSO_URL`,
  `META_TURSO_AUTH_TOKEN`, and `TURSO_API_TOKEN` remain — meta-DB enumeration
  needs them.

### Test evidence

- `pnpm vitest run __tests__/lib/ops/branch-clone.test.ts` — **43 passed**
  (36 baseline + 7 new for Wave 4 A1: multi-tenant fan-out, creds passthrough,
  failure aggregation, orphan skip, empty-meta-DB no-op, slug-prefixed
  skipped aggregate, end-to-end promote integration).
- `pnpm lint` — clean (warnings only, no new ones introduced).
- `pnpm tsc` — no new errors introduced (baseline `origin/main` has 843
  pre-existing errors in unrelated files; with WIP applied, count remains
  843 — verified by stash + recompile diff).
- `pnpm build` — see commit body for green status.

### Wave 4 dependency note

This PR **gates Wave 4c** (PayFast idempotency `0013_payfast_events.sql` +
Einstein updatedAt `0014_animal_camp_updated_at.sql`). Those PRs cannot
merge until this one is merged AND post-merge-promote runs successfully
against all tenants — otherwise their migrations would skip every tenant
beyond the primary.
