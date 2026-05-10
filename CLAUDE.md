# FarmTrack — Agent Instructions

FarmTrack is a multi-tenant livestock farm management SaaS built on Next.js 16 App Router,
Prisma 5 + Turso (libSQL), next-auth v4, Tailwind, and Serwist PWA.

Local dev: `pnpm dev --port 3001`
Deployed: https://farm-management-lilac.vercel.app

---

## Critical Build Rules

- **Build command:** `pnpm build --webpack` — Turbopack breaks Serwist. Never use `turbo` flag for builds.
- **Schema changes:** Add a numbered SQL file under `migrations/` (e.g. `migrations/0002_add_foo.sql`) and run `pnpm db:migrate`. The runner (`scripts/migrate.ts` + `lib/migrator.ts`) iterates every tenant via the meta DB, tracks applied migrations in a per-farm `_migrations` table, and applies each file atomically. Do NOT write new hand-rolled `scripts/migrate-*.ts` scripts (the existing ones are historical) and do NOT run `prisma db push` — it will break the Turso remote database. Update `prisma/schema.prisma` in the same commit as the migration so the Prisma client stays in sync.
- **tsc gotcha:** `tsconfig.json` has `incremental: true`. Always run `rm -rf .next/cache/tsbuildinfo .tsbuildinfo` before trusting a clean `tsc` result.
- **Next.js 16 params:** Must be awaited — `{ params }: { params: Promise<{ campId: string }> }`.

---

## Branching workflow — main is sacred

**As of 2026-04-28, `main` is the live tenant branch.** It is mutated only via explicit `promote` events from Luc. No agent, no contractor, no future-Claude commits to `main` directly. This rule is non-negotiable — it exists because tenants pay for an app that must keep working while we ship new features.

The full rationale, module breakdown, and 13-issue rollout sequence live in [tasks/prd-stabilization-and-multi-species-2026-04-28.md](tasks/prd-stabilization-and-multi-species-2026-04-28.md). Read it before starting any new work.

### What "main is sacred" means in practice

- Every implementation task — bug fix, refactor, new feature, doc update — happens on a sub-branch off `main`.
- Every sub-branch deploys to its own Vercel preview against its own Turso DB clone (Option C, GitHub issue #19). Preview never reads or writes prod.
- Migrations run on the clone first and **soak ≥1h** before any prod migration is even considered. Running a migration against prod without prior soak on a clone is forbidden.
- A PR can only merge into `main` when (a) build green, (b) Vitest green, (c) Playwright smoke green against the branch clone, (d) the `promote` label has been applied (by Luc, or by Claude under §promote-delegation below), (e) the `require` workflow's soak gate has cleared (≥1h since the merge-target SHA was pushed). The CI governance gate (issue #21) enforces this physically.
- On merge, the post-merge job invokes `promote-to-prod <branch>` which runs the prod migration. No manual prod migrations.

### Promote delegation (issue #133)

The `promote` label gates merge into `main`. Luc may always apply it. Claude may apply it when ALL of the following are true:

1. PR is on a `wave/*` branch (never direct-to-main work).
2. All required CI checks are green: `gate`, `require`, `audit-bundle`, `lhci-cold`, `audit-pagination`. Vercel preview deploys are informational and may be FAILURE without blocking (see memory: `feedback-vercel-preview-turso-cli.md`).
3. **Soak gate disabled (Wave 179, 2026-05-10).** The `promote` label may be applied as soon as the four required CI checks (gate, audit-bundle, lhci-cold, audit-pagination) are SUCCESS. There is no temporal soak. Empirical record: across 60+ merges before Wave 179, the soak gate caught zero bugs; the synchronous backstops from PRD #128 (`verifyMigrationApplied` #141, `checkPrismaColumnParity` #137, `audit-findmany-no-select` #140) plus the post-promote authenticated smoke cover the entire known failure surface. Bookkeeping infrastructure (soak_started_at, recordCiPassForCommit, escalatedPathsTouched) is retained for one-line revertability — change `minSoakHours = 0` back to `0.5` (escalated-only) or `1` (blanket) in `lib/ops/branch-clone.ts` to re-enable.

   Pre-#179 history: Wave 178 introduced conditional soak (30 min on escalated paths only); pre-#178 was a blanket 1h. The audit (memory: `wave-history-log.md`, soak-audit section 2026-05-10) showed zero bugs caught across 60 merges across BOTH policies, leading to elimination. The structural backstops cover the migration-replay class synchronously at promote time.
4. The PR's scope was explicitly approved by Luc in conversation OR the PR is a routine wave dispatched from a documented PRD/issue (e.g. wave/130 against PRD #128).
5. The PR does NOT touch security-critical surface area without per-diff Luc approval:
   - `lib/auth-options.ts`, `lib/auth-*.ts`, any file under `app/api/auth/**`
   - `proxy.ts`
   - `app/api/webhooks/**`, anything under `lib/payfast/**`
   - `migrations/**` files that touch `User`, `_migrations`, or that DROP/RENAME columns/tables
6. The PR is not labeled `incident` or `hotfix` (those flow through Luc-eyes).

### What stays Luc-only

- Direct merges that bypass the soak gate (e.g. admin-merging while `require=IN_PROGRESS`).
- Production migrations against tenants outside the wave's branch clone.
- Auth and payment surface diffs.
- Hotfix flow.
- Reverts on `main`.

### Worktree convention

- All sub-branch work happens inside `.worktrees/<wave-name>/` (the directory is gitignored at the repo root).
- Branch name format: `wave/<issue-number>-<short-slug>` — e.g. `wave/18-claude-md-governance`.
- Each worktree tracks `origin/main` so it can rebase cleanly. Long-running waves rebase daily.
- After the PR is merged and promoted, delete the branch + worktree (`git worktree remove`) so ops debt doesn't accumulate.

### Per-wave dispatch convention

Each issue in the rollout corresponds to one wave dispatched as one TDD-agent run:

1. **One TDD agent per wave.** Never bundle waves into one agent call.
2. **File allow-list** is provided in the agent's initial prompt. The agent may not edit files outside the allow-list. This makes scope creep structurally impossible.
3. **Target branch is named in the initial prompt** — the agent works inside the worktree, on the wave's branch, never touching `main`.
4. **TDD red-green-refactor** for any code change: failing test first, minimal implementation, refactor green. For pure docs/governance changes (like this issue), the equivalent is: define a verifiable acceptance check (e.g., a grep) before writing, write the change, run the check.
5. **8-gate demo-ready bar** before merge: build green, Vitest green, Playwright green, deep-audit green, telemetry typed, beta soak ≥24h on the preview, cold demo dry-run, `promote` label applied (Luc or Claude per §promote-delegation).

### Verify-before-promote (replaces the old "commit to main" workflow)

After implementing any change on a sub-branch, before requesting promote:

1. **Verify root cause, not symptom.** Re-read the diff and ask: does this address *why* the bug happened, or just mask what the user noticed? Symptom-patches go back in the queue.
2. **Prove it works.** Run the relevant layer — `npx tsc --noEmit` for type changes, `pnpm vitest run <path>` for logic, `pnpm lint` for style. For UI start the preview deploy and click through the feature in a browser.
3. **Re-audit the diff.** Look for collateral damage, dead code, unresolved TODOs, missing tests.
4. **Push the branch + open a PR.** Reference the issue number. Wait for the CI gate. Wait for the `promote` label (Luc, or Claude per §promote-delegation). Never push to `main` directly.

If verification fails, fix the underlying issue and re-verify on the preview before opening the PR.

---

## Data Principles (No Dummy Data)

**`dummy-data.ts` must never be imported anywhere in the app.** All camp and farm data
comes from the database via API routes or Prisma server queries.

### Camp data flow

- **Server components** (pages, layouts): query Prisma directly — `prisma.camp.findMany()`.
  Prisma returns camelCase (`campId`, `campName`, `sizeHectares`, `waterSource`).
  Map to snake_case before passing to client components as `Camp[]`.
- **Client components**: fetch from `/api/camps` (returns snake_case to match `Camp` type in `lib/types.ts`).
- **OfflineProvider / logger**: uses `useOffline().camps` backed by IndexedDB + `/api/camps` refresh.

### API routes (all require next-auth session)

| Route | Method | Description |
|-------|--------|-------------|
| `/api/camps` | GET | `prisma.camp.findMany()` + animal counts, snake_case response |
| `/api/camps` | POST | Create camp, blocks duplicate campId |
| `/api/camps/[campId]` | DELETE | Delete camp, blocks if has active animals |
| `/api/camps/reset` | DELETE | Delete all camps, blocks if any active animals exist |
| `/api/farm` | GET | `{ farmName, breed, animalCount, campCount }` from DB |

### `/api/camps` response shape (snake_case)

```ts
{ camp_id, camp_name, size_hectares, water_source, geojson, notes, animal_count }
```

---

## Key Component Contracts

### SchematicMap

```ts
props: {
  onCampClick: (campId: string) => void
  filterBy: FilterType
  selectedCampId: string | null
  liveConditions: Record<string, LiveCondition>
  camps: Camp[]
  campAnimalCounts: Record<string, number>
}
```

`getCampColors` is a **pure function**: `(filterBy, liveCondition, animalCount, sizeHectares) => colors`.
It has no imports from dummy-data and no side effects.

### DashboardClient

Receives `camps: Camp[]` and `liveConditions` as props from `app/dashboard/page.tsx`
(which fetches from Prisma). Computes `alertCount` and `inspectedToday` inline from `liveConditions` —
never calls `getAlertCount()` or `getInspectedToday()` from utils.

### OfflineProvider type cast

`useOffline().camps` is typed `Camp[]` but IndexedDB records at runtime can have condition fields
merged in (e.g. `grazing_quality`, `water_status`). Use `camp as (Camp & { grazing_quality?: string })`
to access merged fields.

---

## Prisma / Turso

- Prisma client targets Turso via `@prisma/adapter-libsql` + `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`.
- Local: `.env.local` must contain Turso creds.
- Seed script: `scripts/seed-camps.ts` — run with `npx tsx scripts/seed-camps.ts`.
  Note: script uses `dotenv.config({ path: ".env" })` but Turso creds are in `.env.local`;
  pass creds as shell env vars or insert via `turso db shell` directly if dotenv interferes.

---

## Removed Utils (do not re-add)

These functions were deleted from `lib/utils.ts` because they depended on dummy-data:

`getLastInspection`, `getCampStats`, `getCampById`, `getStockingDensity`,
`daysSinceInspection`, `campHasAlert`, `getLast7DaysLogs`, `getAnimalsByCamp`,
`getInspectedToday`, `getAlertCount`

If similar functionality is needed, compute it from the live data passed as props or fetched from the API.

---

## Product Direction

FarmTrack is a **multi-tenant SaaS** for any livestock farm — not a Trio B Boerdery-specific app.
Keep all code generic: no hardcoded farm names, breed names, or farm-specific data in source code.
Farm identity (`farmName`, `breed`) lives in the `FarmSettings` DB table.

---

## Agent skills

Configuration for the [mattpocock/skills](https://github.com/mattpocock/skills) engineering skills (`/to-prd`, `/to-issues`, `/triage`, `/diagnose`, `/improve-codebase-architecture`, `/tdd`, `/grill-with-docs`).

### Issue tracker

GitHub Issues on `lucvanrhyn/farm-management` via the `gh` CLI. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

Canonical vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) — labels exist on the GitHub repo. See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Domain docs

Single-context — `CLAUDE.md` (this file) is authoritative; `CONTEXT.md` + `docs/adr/` at the repo root are produced lazily by `/grill-with-docs`. See [docs/agents/domain.md](docs/agents/domain.md).
