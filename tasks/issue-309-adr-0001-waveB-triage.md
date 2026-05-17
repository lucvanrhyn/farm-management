# Issue #309 — ADR-0001 Wave B completion (camps + animals) — program triage

**Not a new decision.** ADR-0001 already names camps + animals as Wave B
domain-extraction areas and defines the pattern (`lib/domain/<area>/` pure ops
on `(prisma, input)`, typed errors mapped by `mapApiDomainError`, routes shrink
to adapter wiring). The canonical mirror is `lib/domain/mobs/` (Wave B #151);
the most recent precedent is `lib/domain/observations/` (Wave C, see
`tasks/wave-156-observations-domain.md`). **No new ADR.**

Decomposed into independent, behaviour-preserving sub-waves. Per the §per-wave
dispatch convention these are **never bundled** — one TDD agent each, shipped
and merged before the next starts.

## Sub-waves

### 309a — camps domain (this wave; zero coverage today → highest gap)
`lib/domain/camps/` does not exist. `app/api/camps/[campId]/route.ts` (140 L,
`adminWrite` adapter) carries inline PATCH (existence check + optional-field
update construction) and DELETE (existence + active-animal 409 guard).
→ Extract `updateCamp` / `deleteCamp` + `errors.ts` + `index.ts` + tests;
route shrinks to adapter wiring. Plan: `tasks/wave-309a-camps-domain.md`.

### 309b — animals domain completion
`lib/domain/animals/` has only `create-animal.ts`. `app/api/animals/[id]/
route.ts` (144 L) carries inline GET + PATCH with ~70 L business logic: the
LOGGER/ADMIN field allowlist, the #28 cross-species parent guard, the #98
cross-species camp guard (via `requireSpeciesScopedCamp` +
`CrossSpeciesBlockedError`). → Add `update-animal` / `delete-animal` /
`get-animal` (+ `list-animals` if a list route exists), `errors.ts`,
`index.ts`, tests. The cross-species guard becomes the explicit test surface
and is reusable by the CSV importer / Inngest workers (ADR-0001's stated reuse
goal). Note: `CrossSpeciesBlockedError` currently lives oddly in
`lib/domain/mobs/move-mob` — 309b should evaluate centralising it. Separate
plan written at 309b dispatch time.

### 309c — profitability-by-animal domain extraction (folded from #310)
`lib/server/profitability-by-animal.ts` (single-caller fetch + tagged-vs-camp
transaction partition → forwards to `lib/calculators/profitability-per-animal`)
sits behind an already-migrated `tenantReadSlug` route (Wave G4 #168).
Inlining into the route would contradict ADR-0001's thin-adapter principle;
correct treatment is extraction to `lib/domain/` (likely
`lib/domain/transactions/` — confirm at dispatch). Behaviour zero-change;
re-home its test. Separate plan at 309c dispatch time.

## Shared conventions (all sub-waves)

- Mirror `lib/domain/mobs/` exactly: ops as `(prisma, input)` → JSON-serialisable
  data, throw typed errors; `index.ts` re-export surface; `__tests__/` vitest
  per op with a mocked Prisma double.
- Typed errors map via `lib/server/api-errors.ts` `mapApiDomainError`. Reuse
  existing error classes where the wire code already matches; only add new ones
  for genuinely new failure modes.
- **Behaviour-preserving.** Zero wire change unless an existing test/client
  proves the canonical-envelope direction is already expected for that route.
  Default: preserve current status codes + response bodies exactly. Message-
  bearing 409s mirror `MobHasAnimalsError` (message preserved on the wire).
- Zero migrations / no `prisma/schema.prisma` change in any sub-wave.
- Each route that becomes fully adapter-wired comes out of any EXEMPT set in
  `__tests__/api/route-handler-coverage.test.ts` (mirror Wave C).
- §promote-delegation **routine documented-issue path** applies (no ADR, no
  auth/payment/migration surface, behaviour-preserving) — NOT the arch-PR
  explicit-signoff exception. Ship through merge on green required CI.
