# Wave 4 A2 — `POST /api/mobs` species contract

Closes Codex HIGH (2026-05-02 adversarial review):

> "New mobs default to cattle — `app/api/mobs/route.ts` POST contract missing `species`, falls through to DB default."

Refs: #28 (multi-species refactor — Phase B hard-block, PR #60).

## Problem

`Mob.species` is `@default("cattle")` in `prisma/schema.prisma:252` as a backstop. The POST handler at `app/api/mobs/route.ts:36-65` reads only `{ name, currentCamp }` from the body and calls `prisma.mob.create({ data: { name, currentCamp } })`. A user creating a sheep or game mob through this endpoint silently gets a CATTLE mob; the #28 Phase B cross-species hard-block then produces confusing 422s when they later assign a sheep/game animal to that mob.

## Fix (this wave)

1. Require `species` on the POST body and validate with `isValidSpecies` from `lib/species/registry.ts` (the same registry the schema enums against).
2. Reject 400 if `species` is missing or unknown.
3. Reject 422 with `{ error: "CROSS_SPECIES_BLOCKED" }` when the destination camp's `species` differs from the supplied `species` — mirrors the PATCH route + the animals route so the W4 A10 error-mapper helper sees one consistent contract.
4. Pass `species` into `prisma.mob.create` so the schema default no longer fires silently.

## Allow-list

- `app/api/mobs/route.ts` — primary fix
- `__tests__/api/mobs-post-species.test.ts` — failing-first tests
- `tasks/wave-4-a2-mobs-post-species.md` — this doc
- `components/admin/MobsManager.tsx` — direct in-repo caller; sends `species: mode` (the active FarmMode) so the new contract is satisfied without changing the admin UX

## Checklist

- [x] Failing test first (5 cases: missing/invalid/mismatch/happy/preserves existing 400)
- [x] Implement the validation + cross-species guard
- [x] Pass `species` through to `prisma.mob.create`
- [x] `pnpm vitest run __tests__/api/mobs-post-species.test.ts` — 5/5 green
- [x] `pnpm lint` clean (0 errors on touched files)
- [x] `pnpm tsc` clean on touched files (pre-existing errors unrelated)
- [ ] `pnpm build --webpack` clean
- [ ] Conventional commit + push + PR open
- [ ] PR cites Codex HIGH verbatim, before/after, test evidence
- [ ] Wait ≥1h after PR open before requesting merge

## Known follow-up (out of allow-list)

The mobile client (separate repo per `project-stack.md`) needs to start sending `species` on POST /api/mobs.

`components/admin/MobsManager.tsx` was updated in this PR to send `species: mode` (the active FarmMode). A future #28 Phase D camp-create-picker pass should switch from sending the active mode to deriving species from the chosen camp directly, so a single-mode admin can still create cross-mode mobs without flipping the toggle first. Out of scope for this Codex-HIGH fix.
