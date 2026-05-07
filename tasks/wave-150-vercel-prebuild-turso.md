# Wave 150 — Vercel preview turso CLI install

**Issue:** [#150](https://github.com/lucvanrhyn/farm-management/issues/150)
**Branch:** `wave/150-vercel-prebuild-turso`
**Closes:** #150

## Objective

Restore Vercel preview deploys (failing since 2026-05-01 with `vercel-prebuild ERROR: clone failed — turso db create … exit code ENOENT`) by installing the `turso` CLI on the Vercel build runner before `cloneBranch` is called. The `gate` workflow already does this on the GHA runner via `curl -sSfL https://get.tur.so/install.sh | bash`; mirror that pattern in the Vercel prebuild.

## Decision

Two paths considered:
- **(a) Curl-install in `vercel-prebuild.ts`** — selected. Smallest change, mirrors the proven gate pattern, restores Option C's per-branch DB clone design intent. `lib/ops/turso-cli.ts:41` already reads `TURSO_BINARY` env var, so wiring is trivial.
- **(b) Skip clone, run preview against source DB read-only** — rejected. The source DB (`acme-cattle-dub`) is the prod tenant; preview writes would mutate prod. No "read-only mode" flag exists, and adding one is bigger than the install fix.

Out of scope:
- HTTPS Turso Platform API rewrite (separate larger refactor).
- Cross-build install caching (Vercel build envs are ephemeral; install takes <5s).

## Scope

| File | Change |
|---|---|
| `scripts/vercel-prebuild.ts` | Add `tursoBinaryProbe` + `installTursoCli` to `PrebuildDeps`, wire them into the preview branch only. |
| `__tests__/scripts/vercel-prebuild-turso-install.test.ts` | NEW — 5 cases: install fires when missing · skipped when present · errors propagate as exit 1 · production strict no-op · non-preview no-op. |
| `tasks/wave-150-vercel-prebuild-turso.md` | This doc. |

## Implementation notes

- Probe order in default `tursoBinaryProbe`: `env.TURSO_BINARY` first (already used by `lib/ops/turso-cli.ts:41`), then `which turso`.
- Default installer mirrors `.github/workflows/governance-gate.yml:37` exactly: `curl -sSfL https://get.tur.so/install.sh | bash`. Returns `${HOME}/.turso/turso`.
- Production path is untouched — install logic lives **inside** the `if (vercelEnv === 'preview')` block, after the env-var validation but before `cloneBranch` resolves. Existing strict-no-op invariant stays intact (covered by the production test case).
- Installer failures bubble the same way clone failures already bubble: `log` + `return 1`.

## Acceptance criteria

- [x] `pnpm build` green
- [x] `pnpm lint` 0 errors
- [x] `pnpm vitest run __tests__/scripts/ __tests__/lib/ops/branch-clone.test.ts` — 163 tests across 8 files, all green
- [x] `npx tsc --noEmit` introduces zero new errors over `origin/main` (7 pre-existing failures in untouched `tests/e2e/*` + `__tests__/einstein/*` files)
- [ ] First Vercel preview deploy on this branch is GREEN — verifies in-the-wild behaviour. Acceptance proof attached on PR via the Vercel check.

## Verification log

```
$ pnpm install --prefer-offline    # green
$ pnpm prisma generate              # green
$ pnpm vitest run __tests__/scripts/vercel-prebuild-turso-install.test.ts \
                  __tests__/scripts/vercel-prebuild.test.ts
  Test Files  2 passed (2)
        Tests  15 passed (15)
$ pnpm lint                         # 0 errors, 138 warnings (all pre-existing)
$ pnpm build                        # green (prisma + eslint + next build --webpack)
$ pnpm vitest run __tests__/scripts/ __tests__/lib/ops/branch-clone.test.ts \
                  __tests__/scripts/branch-clone-cli.test.ts
  Test Files  8 passed (8)
        Tests  163 passed (163)
```

## Lessons referenced

- `feedback-vercel-preview-turso-cli.md` — the root-cause memo for this very bug.
- `feedback-build-not-just-test.md` — `pnpm build` runs first.
- `feedback-agent-silent-staging.md` — `git status -sb` post-commit before pushing.
