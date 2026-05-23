# Wave 309c — profitability-by-animal domain extraction (folded from #310)

Final #309 sub-wave (ADR-0001 Wave B). **No ADR** — ADR-0001 governs.
Behaviour-preserving; zero migration. This is the item reclassified from
closed #310: a single-caller fetch+transform that must NOT be inlined into its
route (that would contradict ADR-0001 thin-adapter); it belongs in the domain
layer.

## Goal

Move `lib/server/profitability-by-animal.ts` (`getProfitabilityByAnimal`) into
the existing **`lib/domain/transactions/`** domain (Wave D #159) — it is a
transaction-derived read (Prisma `transaction.findMany` + `animal.findMany`,
partition into tagged-vs-camp transactions, forward to the pure calculator
`lib/calculators/profitability-per-animal.ts`). Behaviour: **zero change**.

Verified single caller: `app/api/[farmSlug]/profitability-by-animal/route.ts`
(an already-migrated `tenantReadSlug` adapter, Wave G4 #168). The route's
Wave-G4 comment claiming "many other consumers reference it" is **stale** —
re-verified during the #310 triage: `multi-farm-overview.ts:55` is only a
comment, the admin component hits the API route, not the function. Confirm
again with grep before deleting the old file.

## Moves

1. Create `lib/domain/transactions/profitability-by-animal.ts` — the
   `getProfitabilityByAnimal(prisma, dateRange?)` body lifted **verbatim**
   (same Prisma queries, same `select`s, same tagged/camp partition, same
   `calcProfitabilityByAnimal` call, same `AnimalProfitabilityRow` return).
   Keep the "cross-species by design" comment on the `animal.findMany` — it
   encodes a live invariant the species-where audit relies on.
2. Re-export from `lib/domain/transactions/index.ts` (mirror the other
   transactions ops' export style).
3. Delete `lib/server/profitability-by-animal.ts`.
4. Rewire `app/api/[farmSlug]/profitability-by-animal/route.ts`: change the
   import `@/lib/server/profitability-by-animal` → `@/lib/domain/transactions`.
   **Keep every bespoke route concern exactly** (the `ADVANCED_TIERS` tier
   gate, `getFarmCreds` 404 `{error:"Farm not found"}`, 403 `{error:"Advanced
   plan required"}`, date-param 400 `{error:"Invalid date params"}`, the
   try/catch 500 `{error:"Internal server error"}`, `force-dynamic`). Wave G4
   deliberately keeps these as handler logic — do NOT move them.
5. Grep for any other importer of `@/lib/server/profitability-by-animal` and
   re-point it (expected: none beyond the route).

## audit-species-where baseline (309a/309c lesson — this WILL trip)

`.audit-species-where-baseline.json` contains
`"lib/server/profitability-by-animal.ts::animal::findMany::0"` (the
cross-species `prisma.animal.findMany({where:{status:'Active'}})`). Moving the
code makes that entry dead and surfaces a new offender at the new path. Fix
root-cause (same as 309a): run `pnpm tsx scripts/audit-species-where.ts`
locally; **remove** the dead `lib/server/profitability-by-animal.ts::...`
entry; **add** the relocated key for
`lib/domain/transactions/profitability-by-animal.ts` — read the exact
`model::operation::occurrenceIndex` from the audit module's own output, do not
guess; preserve the file's alphabetical ordering. The `transaction.findMany`
is on a non-species model → not audited; only the one `animal::findMany::0`
entry relocates. Confirm local audit exits 0 / "0 new offenders".

## Testability payoff (the deepening win)

The shallow `lib/server/` module had **no test**. As a domain op it gets one:
add `lib/domain/transactions/__tests__/profitability-by-animal.test.ts` with a
mocked Prisma double asserting the partition logic — tagged transactions
(`animalId != null`), camp-level transactions (`campId != null && animalId ==
null`), `type` lowercasing, the `animalId`-as-tagNumber mapping, and the
`dateRange` → `txWhere` translation. The pure calculator
(`lib/calculators/profitability-per-animal.ts`) keeps its own existing test
and is **not** touched.

## In-scope edits

- `lib/domain/transactions/profitability-by-animal.ts` — new (verbatim move).
- `lib/domain/transactions/index.ts` — add the re-export.
- `lib/server/profitability-by-animal.ts` — **delete**.
- `app/api/[farmSlug]/profitability-by-animal/route.ts` — import re-point only;
  update the stale "outside the wave's allow-list / many consumers" comment to
  reflect the new home + that it is now a domain op.
- `lib/domain/transactions/__tests__/profitability-by-animal.test.ts` — new.
- `.audit-species-where-baseline.json` — the single relocation.
- `tasks/wave-309c-profitability-domain.md` (this); append 309c-done +
  "#309 complete" status to `tasks/issue-309-adr-0001-waveB-triage.md`.

## Out of scope (do NOT touch)

- `lib/calculators/profitability-per-animal.ts` (the pure calc — unchanged).
- Route bespoke logic (tier gate / date parse / error envelopes) — keep verbatim.
- Any other domain dir, `prisma/schema.prisma`, `migrations/**`, auth/payfast/proxy.

## TDD sequence

1. RED: write the partition test against `lib/domain/transactions/
   profitability-by-animal` (import path that doesn't exist yet) — fails.
2. GREEN: move the file verbatim + wire the index export → test passes.
3. REFACTOR: re-point the route import; delete the old file; fix the route
   comment; relocate the audit baseline entry; grep-confirm no other importer.
4. VERIFY: `rm -rf .next/cache/tsbuildinfo .tsbuildinfo && npx tsc --noEmit`;
   `pnpm tsx scripts/audit-species-where.ts` (0 new offenders);
   `pnpm vitest run lib/domain/transactions __tests__` + any profitability
   route test; full `pnpm vitest run` (0 failures — classify any as
   pre-existing via `git diff --name-only origin/main`); `pnpm build
   --webpack` (NEVER turbo).

## Promote path

§promote-delegation routine documented-issue wave (#309/309c), `wave/*`
branch, no auth/payment/migration surface, behaviour-preserving, not the
arch-PR exception. Ship through merge on green required CI. This closes #309.

## 309c — done

Verbatim move complete. `lib/domain/transactions/profitability-by-animal.ts`
created (body byte-identical incl. the "cross-species by design" comment),
re-exported from `lib/domain/transactions/index.ts`, old
`lib/server/profitability-by-animal.ts` deleted. Sole caller
`app/api/[farmSlug]/profitability-by-animal/route.ts` re-pointed to
`@/lib/domain/transactions`; every bespoke route concern (ADVANCED_TIERS
gate, getFarmCreds 404, 403/400/500 envelopes, force-dynamic) kept verbatim;
stale Wave-G4 "many consumers / outside allow-list" comment corrected to the
new domain home. grep re-confirmed the route is the only importer
(`multi-farm-overview.ts:55` is a comment, not an import).
`.audit-species-where-baseline.json`: surgical relocation of the single
`animal::findMany::0` key from the old `lib/server/` path to the new
`lib/domain/transactions/` path (alphabetical order preserved); local audit
"no new offenders", exit 0. New mocked-Prisma test
`lib/domain/transactions/__tests__/profitability-by-animal.test.ts` pins the
partition logic the shallow `lib/server/` module never had. **#309 program
complete** (309a + 309b + 309c shipped).
