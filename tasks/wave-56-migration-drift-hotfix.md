# Wave 56 — Migration prefix-collision SEV-1 hotfix

**Issue:** #56 (SEV-1) — both paying tenants (basson-boerdery, trio-b-boerdery)
seeing HTTP 500s on `/admin/animals`, `/admin/camps`, `/admin/tasks`, and
`/trio-b/logger`.

**Branch:** `wave/56-migration-drift-hotfix` (off `origin/main` at `c556a28`).
**Worktree:** `.worktrees/wave/56-migration-drift-hotfix/`.

---

## Root cause

Two pairs of migration files shipped to `migrations/` with **colliding numeric
prefixes**:

```
0005_camp_mob_species.sql        ↔  0005_sars_livestock_election.sql
0006_aia_tag_fields.sql          ↔  0006_farmsettings_tax_ref_number.sql
```

The runner (`lib/migrator.ts`) sorts files via `localeCompare` and keys
`_migrations.name` on the **full filename**. With colliding prefixes the two
files in a pair are interleaved by the secondary characters of their name —
deterministic but fragile, and drift-prone if a peer tenant has already
applied a different ordering.

The 2026-05-01 `post-merge-promote` for wave/26e crashed mid-batch on at
least one tenant and never re-ran cleanly. Result: at least one column from
each colliding pair is missing on prod tenants. Prisma queries against the
HEAD schema (which expects all six columns) return `PrismaClientKnownRequest`
errors, surfaced as HTTP 500 on the four broken pages.

The columns the prod DBs are missing (per HEAD `prisma/schema.prisma`):

* `Camp.species`, `Mob.species`, composite UNIQUE `Camp_species_campId_key` —
  from `0005_camp_mob_species.sql`
* `SarsLivestockElection` table — from `0005_sars_livestock_election.sql`
* `Animal.tagNumber`, `Animal.brandSequence`, `FarmSettings.aiaIdentificationMark`
  — from `0006_aia_tag_fields.sql`
* `FarmSettings.taxReferenceNumber` — from `0006_farmsettings_tax_ref_number.sql`

---

## Remediation

### Code (defense in depth — prevents the class of bug)

1. **`lib/migrator.ts` — collision detector.** `loadMigrations` now groups
   all `.sql` files by their leading `NNNN_` prefix and throws if any
   prefix bucket has more than one file. The error message names every
   colliding file so the operator can renumber. Future PRs that introduce a
   collision fail at `pnpm db:migrate` time — no tenant DB ever sees the
   ambiguous ordering.

2. **`lib/migrator.ts` — applied-set refresh.** `runMigrations` now refreshes
   the in-memory `applied` set after any migration whose SQL touches
   `_migrations`. This makes rename-bookkeeping migrations (option A below)
   safe in a single `runMigrations` call.

3. **`__tests__/migrator/migrator.test.ts` — RED→GREEN coverage.** Three new
   tests cover the collision detector itself, plus two integration tests
   exercise the live `0008_record_legacy_renames.sql` against (a) a tenant
   pre-stamped with the legacy 0005/0006 names, and (b) a fresh tenant. The
   first test pins the SEV-1 wire — if a future renumber forgets the
   bookkeeping step, it will fail with a clear assertion.

### Data (the actual schema-drift fix)

**Choice: Option A** (renumber + bookkeeping migration), per the prompt's
"preferred" option. Reasoning:

* Option B (keep names, just run `pnpm db:migrate`) would have the new
  collision detector throw on every `loadMigrations` call against the
  current `migrations/` directory — including `pnpm db:migrate:prod`. The
  detector and the existing collisions are mutually exclusive.
* Option A breaks the collision permanently and lets the detector defend
  the directory going forward.

Renames:

```
0005_camp_mob_species.sql         → 0009_camp_mob_species.sql
0005_sars_livestock_election.sql  → 0010_sars_livestock_election.sql
0006_aia_tag_fields.sql           → 0011_aia_tag_fields.sql
0006_farmsettings_tax_ref_number.sql
                                   → 0012_farmsettings_tax_ref_number.sql
migrations/rollback/0005_camp_mob_species.down.sql
                                   → migrations/rollback/0009_camp_mob_species.down.sql
```

(Existing `0007_transaction_is_foreign.sql` was untouched — it has no
collision.)

The renumbered files alone are unsafe for tenants that already applied the
legacy names: the migrator would treat the new filenames as fresh and try to
re-apply non-idempotent `ALTER TABLE … ADD COLUMN` statements, crashing.
**`migrations/0008_record_legacy_renames.sql`** sorts before the renamed
files and `INSERT OR IGNORE`s the new filenames into `_migrations` for any
tenant whose `_migrations` already contains the legacy filenames. The
`runMigrations` applied-set refresh (point 2 above) ensures the rest of the
loop sees those rows and skips the renamed files in the same run. Fresh
tenants (clones provisioned after the rename) see neither legacy nor new
names; the `WHERE EXISTS` guard makes 0008 a no-op for them, and the
0009..0012 files apply normally.

---

## File-level changes

| Path | Change |
| --- | --- |
| `lib/migrator.ts` | Add `assertNoPrefixCollisions` invoked from `loadMigrations`. Refresh `applied` set inside `runMigrations` when a migration writes to `_migrations`. |
| `__tests__/migrator/migrator.test.ts` | RED→GREEN: 3 collision-detection unit tests + 2 wave/56 integration tests against the live `migrations/` dir. |
| `migrations/0005_camp_mob_species.sql` | Renamed to `0009_camp_mob_species.sql`; header comment updated. |
| `migrations/0005_sars_livestock_election.sql` | Renamed to `0010_sars_livestock_election.sql`; header comment added. |
| `migrations/0006_aia_tag_fields.sql` | Renamed to `0011_aia_tag_fields.sql`; header comment updated. |
| `migrations/0006_farmsettings_tax_ref_number.sql` | Renamed to `0012_farmsettings_tax_ref_number.sql`; header comment updated. |
| `migrations/rollback/0005_camp_mob_species.down.sql` | Renamed to `0009_camp_mob_species.down.sql`; header + manual-apply note updated to cover both legacy and new `_migrations` names. |
| `migrations/0008_record_legacy_renames.sql` | NEW. Stamps the renamed filenames as applied for tenants that already ran the legacy names. |
| `lib/server/__tests__/migration-camp-mob-species.test.ts` | Constants `UP_FILE`, `DOWN_FILE`, and one `expect(entries).toContain(...)` updated to the renamed filenames. |
| `tasks/wave-56-migration-drift-hotfix.md` | This log. |

The only file outside the strict allow-list that was touched is
`lib/server/__tests__/migration-camp-mob-species.test.ts`. Three constants
(`UP_FILE`, `DOWN_FILE`, and one `toContain` assertion) hardcoded the
literal filenames being renamed. These updates are pure mechanical
"internal references" of the rename — without them, Vitest is RED and the
PR can't merge through the CI gate.

---

## Verification — code

* `pnpm vitest run __tests__/migrator/migrator.test.ts lib/server/__tests__/migration-camp-mob-species.test.ts` — **30 / 30 pass**
* `pnpm vitest run` — **207 files (205 pass, 2 skipped), 2173 tests (2154 pass, 19 skipped), 0 failed**
* `npx tsc --noEmit` — clean for all wave/56 files. Pre-existing errors in
  `__tests__/einstein/useAssistantName.test.ts`, `e2e/*.spec.ts`, and
  `tests/e2e/*.spec.ts` confirmed unchanged from `origin/main` (`c556a28`).

---

## Verification — prod tenants (Phase 4 + 5)

**BLOCKED** in this session by tooling: the local `turso` CLI is not
authenticated (`turso db list` returns "not logged in"), and per the
"main is sacred" rule and Auto Mode rule #5 (no destructive changes to
shared / production systems without explicit confirmation) I do not run
prod migrations from a sub-branch agent. The recovery path:

1. PR is opened against `main` with this code change.
2. Soak ≥1h on the per-branch Turso clone (per rule).
3. Luc applies the `promote` label.
4. The merge triggers `post-merge-promote` which runs `pnpm db:migrate:prod`
   against every tenant DB. The migrator is idempotent: it'll apply
   `0008_record_legacy_renames.sql` (a no-op for tenants whose 0005/0006
   files crashed mid-batch and never recorded their bookkeeping rows — for
   them the legacy names are NOT in `_migrations`, so the WHERE-EXISTS guard
   short-circuits all four conditional inserts) and then 0009..0012 apply
   the missing DDL.
5. After the post-merge-promote completes, the four broken surfaces should
   return 200.

**Audit-mode runbook** for Luc once authenticated, BEFORE merge, to know
exactly which tenant is in which state:

```sh
# Per tenant — record findings here:
turso db shell <farm-prod-db> "SELECT name FROM _migrations ORDER BY name"
turso db shell <farm-prod-db> ".schema Animal"
turso db shell <farm-prod-db> ".schema Camp"
turso db shell <farm-prod-db> ".schema FarmSettings"
turso db shell <farm-prod-db> ".schema Mob"
turso db shell <farm-prod-db> "SELECT name FROM sqlite_master WHERE type='table' AND name='SarsLivestockElection'"
```

If the audit shows ALL the legacy 0005/0006 names present in
`_migrations` AND all the columns in place, the surfaces would be 200ing
already — i.e., the original premise is wrong and only the collision
detector + renumber are needed (no actual prod DDL). The expected finding
is partial: at least one of the four legacy names is missing from
`_migrations` on each tenant, and the corresponding columns are missing.

---

## Lessons captured

* `lib/migrator.ts`'s `_migrations.name` keying is intentionally robust to
  reordering, but **only** when filenames are unique. Two files with the
  same `NNNN_` prefix create a hidden coupling between sort order and
  applied-set membership. The new collision detector closes this hole.
* `runMigrations` previously fetched the applied-set once and never
  refreshed. Rename-bookkeeping migrations (and any future migration that
  writes to `_migrations` itself) need the loop to honour those writes.
  The targeted refresh — only when the migration's SQL mentions
  `_migrations` — keeps the cost minimal.
* `feedback-quote-sql-keywords-in-migrations.md` flagged the `Transaction`
  keyword in `0007_transaction_is_foreign.sql` as a separate hazard — it's
  unrelated to wave/56 (handled by `hotfix-tx-keyword`) and not in scope here.
