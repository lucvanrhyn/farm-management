# Promote-to-Prod Runbook

Self-contained operator guide for the full promote flow. No prior context required.

---

## 1. What promote is

`main` is sacred — it is only mutated via merged PRs, and every merge that touches production data must carry the `promote` label. Each feature branch has its own isolated Turso DB clone (Option C, issue #19): when a PR is opened, `ops:clone-branch` provisions a per-branch copy of the source tenant DB, and all CI runs (vitest, `next build`, Playwright smoke) execute against that clone — never against prod. The governance gate (Phase 1) enforces build + test + smoke green before a merge is possible. The label guard (Phase 2) ensures that only authorised actors (CODEOWNERS) can apply `promote`, removing it and failing the check if anyone else tries. Once the PR is squash-merged, the post-merge promote job (Phase 4) invokes `pnpm ops:promote-branch <branch>`, which enforces a ≥1 h soak gate, then applies pending Prisma migrations against the real production DB, marks the meta row promoted, comments on the PR, and recycles the clone.

---

## 2. Required GitHub Actions secrets

| Secret | Used by | Source |
|---|---|---|
| `META_TURSO_URL` | gate, promote | meta-DB libsql URL |
| `META_TURSO_AUTH_TOKEN` | gate, promote | `--expiration none` token for meta-DB |
| `TURSO_API_TOKEN` | gate, promote | `turso auth api-tokens mint <name>` |
| `PROD_TENANT_DB_URL` | promote only | libsql URL of prod tenant DB |
| `PROD_TENANT_DB_AUTH_TOKEN` | promote only | `--expiration none` token for prod tenant DB |

Optional repo variable: `BRANCH_CLONE_SOURCE_DB` — defaults to `basson-boerdery` in the workflow.

### How to set these

```bash
gh secret set META_TURSO_URL --body "libsql://farmtrack-meta.turso.io"
gh secret set META_TURSO_AUTH_TOKEN --body "<token>"
gh secret set TURSO_API_TOKEN --body "<token>"
gh secret set PROD_TENANT_DB_URL --body "libsql://basson-boerdery.turso.io"
gh secret set PROD_TENANT_DB_AUTH_TOKEN --body "<token>"
gh variable set BRANCH_CLONE_SOURCE_DB --body "basson-boerdery"
```

---

## 3. Required branch-protection ruleset

Full UI walkthrough: `tasks/branch-protection-setup.md`.

Two required status checks (both must be green before merge unlocks):

| Check name | Workflow |
|---|---|
| `Governance gate / gate` | `.github/workflows/governance-gate.yml` |
| `Require promote label / require` | `.github/workflows/require-promote-label.yml` |

`Promote label guard / guard` (`.github/workflows/promote-label-guard.yml`) runs on `pull_request_target: [labeled]` and is intentionally NOT a required status check — labelled events do not fire on every push, so making it required would deadlock unlabelled PRs. The guard's enforcement is observational: it runs on every label application and removes any `promote` label applied by a non-CODEOWNER actor before the `Require promote label` check next runs.

Additional ruleset settings:
- Squash-only merge (no merge commits, no rebase).
- CODEOWNERS-required reviews + last-push-approval are currently `false` (solo-dev relax — see `feedback-solo-dev-ruleset-trap.md`). Re-enable when a second human reviewer joins.

---

## 4. Happy-path flow

1. Create a sub-branch off `main` per the `CLAUDE.md` "main is sacred" workflow.
2. Push opens a PR. `Governance gate` workflow fires:
   - Provisions a Turso clone via `ops:clone-branch`.
   - Runs `pnpm vitest run`, `next build`, and Playwright smoke tests against the clone.
3. `Require promote label` check fails (blocking) until the authorised actor applies the `promote` label.
4. If an unauthorised actor applies `promote`, `Promote label guard` removes it, posts a rejection comment linking to this runbook, and marks its check failed.
5. Luc (CODEOWNERS) reviews the PR and applies `promote`. `Require promote label` re-evaluates and goes green.
6. Once both required checks (`gate` + `require`) are green, the merge button unlocks. Squash-merge.
7. `post-merge-promote.yml` fires on `main` push:
   - Provisions Turso CLI.
   - Calls `pnpm ops:promote-branch <branch>`.
   - Soak gate enforced: clone must be ≥1 h old (see `tasks/option-c-runbook.md` §6).
   - Prisma migrations applied against `PROD_TENANT_DB_URL`.
   - Meta row marked promoted in the meta-DB.
   - Bot comments on the PR with a success summary.
   - Clone recycled via `ops:destroy-branch`.

---

## 5. Failure modes + recovery

### 5.1 — Smoke fails on the gate

The gate (vitest / build / Playwright) fails. The merge button stays locked.

Recovery:
1. Read the failing job log in GitHub Actions.
2. Fix the bug on the branch.
3. Push the fix — CI re-runs automatically.
4. The smoke must pass before applying `promote`.

Do not apply `promote` to a red gate — the label guard does not prevent this, but the merge button will remain locked because `Governance gate / gate` is a required check.

### 5.2 — Soak not met

The PR was opened less than 1 h ago and Luc attempted to merge. The post-merge job fails with `SoakNotMetError`. An incident issue is auto-opened (label `incident,prod-promote-failed`) documenting the failure.

Recovery:
1. Wait until the clone is ≥1 h old (check the meta-DB row or the workflow log for exact clone timestamp).
2. In GitHub Actions, navigate to the failed `post-merge-promote` run and click **Re-run failed jobs**.
3. The soak gate will pass and the promote will complete.

Do not use `--force-skip-soak` to work around a soak failure — the purpose of the soak is to catch late-breaking issues. If it truly cannot wait, see §6.

### 5.3 — Migration fails on prod

This is the dangerous case. The auto-opened incident issue (label `incident,prod-promote-failed`) is your starting point. Do not close it until the recovery is complete and verified.

Step-by-step recovery:

1. Read `tasks/option-c-runbook.md` §9 — failure recovery.
2. Identify the failed migration from the workflow log (exact file name and SQL error).
3. If the migration partially applied (SQL error mid-file), the migrator is idempotent for whole-file applies only — a partial file leaves prod in a half-state. Assess the damage:
   ```bash
   turso db shell <PROD_TENANT_DB_URL>
   ```
   Inspect which tables or columns were created before the error. Manually drop or reverse partial changes before re-running.
4. Fix the migration SQL, push to a new branch, and run the full gate cycle (clone → vitest → smoke → soak → promote). Never patch prod directly as the only copy of the fix.
5. NEVER use `--force-skip-soak` to compensate for a broken prod. If prod is in a half-state, the redo must go through the full gate + soak cycle.

---

## 6. Manual emergency promote (escape hatch)

Use this only if GitHub Actions is unavailable (platform outage) and the promote cannot wait.

```bash
cd farm-management
export META_TURSO_URL="..."
export META_TURSO_AUTH_TOKEN="..."
export TURSO_API_TOKEN="..."
export PROD_TENANT_DB_URL="libsql://basson-boerdery.turso.io"
export PROD_TENANT_DB_AUTH_TOKEN="..."
pnpm ops:promote-branch <branchName>
```

This runs the identical code path as the workflow. The soak gate still applies.

Use `--force-skip-soak` ONLY in genuine emergencies — document the reason in a file under `tasks/.meta-test-runs/` and add a note to `MEMORY.md` so the bypass is auditable.

---

## 7. After-promote cleanup

On success, the post-merge workflow recycles the clone automatically via `ops:destroy-branch`.

If the workflow failed mid-way and the clone still exists:

```bash
pnpm ops:destroy-branch <branchName>
```

Stale clones (>7 d) are flagged by the daily monitoring command:

```bash
pnpm ops:daily-summary
```

Full details in `tasks/option-c-runbook.md` §8.

---

## 8. Cross-references

| Resource | Purpose |
|---|---|
| `CLAUDE.md` | "main is sacred" branching workflow |
| `tasks/option-c-runbook.md` | Option C clone provisioner (the underlying primitive) |
| `tasks/branch-protection-setup.md` | UI walkthrough for branch-protection ruleset |
| `tasks/branch-protection-meta-test.md` | 4-scenario meta-test checklist |
| `.github/workflows/governance-gate.yml` | The gate (build + vitest + smoke) |
| `.github/workflows/promote-label-guard.yml` | The label guard (Promote label guard) |
| `.github/workflows/require-promote-label.yml` | Required label check (Require promote label) |
| `.github/workflows/post-merge-promote.yml` | The promoter (post-merge job) |
