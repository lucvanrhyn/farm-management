#!/usr/bin/env bash
#
# setup-worktree.sh — prepare a freshly-created git worktree for building.
#
# A new worktree under .worktrees/<wave-name>/ shares the repo's git history
# but NOT its generated artifacts. The recurring gotcha (see memory
# feedback-worktree-path-and-edit-disk-sync.md and the "worktree gotcha:
# pnpm prisma generate before tsc/build" note): the Prisma client is generated
# into node_modules and is absent in a fresh worktree, so `tsc`/`next build`
# fail with cryptic type errors until it is generated. The stale .next/cache
# carried over from a sibling checkout can also poison the first build.
#
# Run ONCE from inside the new worktree directory immediately after
# `git worktree add`:
#
#   cd .worktrees/<wave-name>
#   ../../scripts/setup-worktree.sh      # or: bash scripts/setup-worktree.sh
#
# Idempotent — safe to re-run.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

echo "→ setup-worktree: $(pwd)"

echo "→ pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile

echo "→ pnpm prisma generate (the worktree gotcha: client is absent in a fresh tree)"
pnpm prisma generate

echo "→ clearing stale .next/cache"
rm -rf .next/cache

echo "✓ worktree ready — tsc / next build / vitest will now resolve the Prisma client"
