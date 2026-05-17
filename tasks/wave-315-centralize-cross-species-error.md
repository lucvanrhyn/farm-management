# Wave 315 — Centralize `CrossSpeciesBlockedError`

ADR-0001 follow-up (optional cleanup #1 from the #306 architecture session,
deferred out of scope by 309b). Behaviour-preserving relocation only.

## Problem

`CROSS_SPECIES_BLOCKED` + `CrossSpeciesBlockedError` are defined inside
`lib/domain/mobs/move-mob.ts`, but the error is a **species-isolation
invariant** (#28 Phase B) thrown by *two* domains and referenced by a third:

- `lib/domain/mobs/move-mob.ts` — camp-species guard (`throw`).
- `lib/domain/animals/update-animal.ts` — parent-species guard (`throw`),
  importing it cross-domain from `@/lib/domain/mobs/move-mob`. **This is the
  leak**: the animals domain reaches into the mobs domain's internal file.
- `lib/domain/rotation/execute-step.ts` — references it in docs (maps to 422).
- `lib/server/api-errors.ts` — `instanceof` map → 422 `{ error:
  "CROSS_SPECIES_BLOCKED" }`.

The error is not a *mobs* concept. It belongs with the species concept.

## Solution

Move the definition to a new shared module **`lib/species/errors.ts`**
(`lib/species/` already houses `registry.ts` + `types.ts` that every domain
imports; the error encodes the registry's isolation guarantee). Update every
importer to the canonical path. The mobs barrel still legitimately
re-exports it (mobs *does* throw it — public surface, not a shim) but
re-exports **from** `@/lib/species/errors`.

**Zero wire change.** `mapApiDomainError` still does `instanceof
CrossSpeciesBlockedError → 422 { error: "CROSS_SPECIES_BLOCKED" }`.

## File allow-list

NEW:
- `lib/species/errors.ts` — verbatim move of `CROSS_SPECIES_BLOCKED` const +
  `CrossSpeciesBlockedError` class + its docstring.
- `lib/species/__tests__/errors.test.ts` — class-shape test (name, `.code`,
  `super(CROSS_SPECIES_BLOCKED)` message, `mobSpecies`/`campSpecies` fields).

EDIT:
- `lib/domain/mobs/move-mob.ts` — delete the def; add
  `import { CrossSpeciesBlockedError } from "@/lib/species/errors";` for the
  `throw` at (old) line 97. Keep `MobNotFoundError` (mobs-specific, stays).
- `lib/domain/mobs/index.ts` — the `./move-mob` re-export block must stop
  exporting `CrossSpeciesBlockedError, CROSS_SPECIES_BLOCKED`; add a
  re-export `from "@/lib/species/errors"` instead (mobs public surface
  preserved). Update the leading docstring para accordingly.
- `lib/domain/animals/update-animal.ts:26` — import from
  `@/lib/species/errors`. Update the line-139 comment if it names the path.
- `lib/domain/animals/__tests__/update-animal.test.ts:42` — import from
  `@/lib/species/errors`.
- `lib/server/api-errors.ts:4-6` — split the import: `CrossSpeciesBlockedError`
  from `@/lib/species/errors`; `MobNotFoundError` stays from
  `@/lib/domain/mobs/move-mob`.
- Doc-only reference fixes (no code change): `lib/domain/animals/index.ts:22`,
  `lib/domain/animals/errors.ts:23`, `lib/domain/mobs/update-mob.ts:13`,
  `lib/domain/rotation/execute-step.ts:25`, `app/api/animals/[id]/route.ts:28`,
  `app/api/mobs/[mobId]/route.ts:12` — repoint the prose `@/lib/domain/mobs/
  move-mob` mention to `@/lib/species/errors`. (309b's "centralising it is
  out of scope" note in `animals/index.ts`/`errors.ts` becomes "centralised
  in `@/lib/species/errors` (#315)".)

DO NOT touch any other file. No `app/**` handler logic changes. No
`prisma.*` call-site moves → **the audit baselines are NOT affected**;
re-run all audits to prove 0-new-offenders regardless.

## Acceptance

1. `git grep -n 'CrossSpeciesBlockedError\|CROSS_SPECIES_BLOCKED' -- 'lib/**'
   'app/**'` shows the **only** definition site is `lib/species/errors.ts`;
   every other code (non-comment) line is an import/re-export/`instanceof`/
   `throw`, none defining it, none importing the *class* from
   `@/lib/domain/mobs/move-mob`.
2. `rm -rf .next/cache/tsbuildinfo .tsbuildinfo && npx tsc --noEmit` clean.
3. `pnpm vitest run` fully green (mobs move, animals parent-guard, rotation,
   api-errors map, new species/errors test).
4. `pnpm tsx scripts/audit-species-where.ts` and
   `pnpm tsx scripts/audit-findmany-no-take.ts` (and `-no-select`) report
   **0 new offenders** with the committed baselines unchanged.
5. `pnpm build --webpack` green.

## Out of scope

- Any behaviour/wire change.
- Touching `app/api/animals/route.ts` or `app/api/camps/route.ts` (those are
  Waves 316a/316b).
- Renaming the error or its `CROSS_SPECIES_BLOCKED` wire code.
