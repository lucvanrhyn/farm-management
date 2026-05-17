# Wave 316a — Extract `POST /api/camps` into `lib/domain/camps/create-camp.ts`

ADR-0001 follow-up (optional cleanup #2a from the #306 architecture
session). Behaviour-preserving extraction — wire shape byte-identical.
Mirrors the 309a `updateCamp`/`deleteCamp` precedent exactly.

## Current state

`app/api/camps/route.ts` (140 lines):
- **GET** — already a thin `tenantRead` adapter delegating to
  `getCachedCampList(ctx.slug, species)`. **LEAVE AS-IS.** Extracting a
  3-line cached delegate would be a shallow wrapper (deletion test: deleting
  it concentrates no complexity). Add a one-line comment noting GET stays
  thin by design.
- **POST** — `adminWrite` adapter with ALL business logic inline: the
  `SPECIES_OMITTED` sentinel → 422 `{ error: "MISSING_SPECIES" }`, the
  species-scoped duplicate check (`prisma.camp.findFirst`), palette colour
  auto-assign (`prisma.camp.count`), `prisma.camp.create`, and the
  snake_case 201 response body. **Extract this into a domain op.**

## Solution

NEW `lib/domain/camps/create-camp.ts` — `createCamp(prisma, input)`:
- Input = the **already-parsed** `CreateCampBody` (the route keeps its
  `createCampSchema` parse adapter + the `SPECIES_OMITTED` sentinel const,
  exactly as 309a kept `patchCampSchema` in the route). The op receives the
  parsed body including the sentinel.
- Business rules lifted **verbatim** (do not re-derive):
  1. If `species === SPECIES_OMITTED` → `throw new MissingSpeciesError()`.
  2. `prisma.camp.findFirst({ where: { campId, species } })` → if found,
     `throw new DuplicateCampError()`.
  3. colour auto-assign: if no `color`, `prisma.camp.count()` →
     `CAMP_COLOR_PALETTE[campCount % CAMP_COLOR_PALETTE.length]`.
  4. `prisma.camp.create({ data: {...} })`.
  5. Return the JSON-serialisable snake_case object
     `{ camp_id, camp_name, size_hectares, water_source, geojson, color,
     animal_count: 0 }` (NOT a NextResponse — the route wraps it).
- The op owns `SPECIES_OMITTED` only if cleaner; otherwise import the
  sentinel the route already defines. Pick whichever keeps ONE source of
  truth for the sentinel string — do not duplicate the literal.

NEW errors in `lib/domain/camps/errors.ts` (append, mirror the existing
`CampHasActiveAnimalsError` message-preserving pattern):
- `MISSING_SPECIES` const + `MissingSpeciesError` → mapped 422
  `{ error: "MISSING_SPECIES" }`.
- `DUPLICATE_CAMP` const + `DuplicateCampError` → mapped 409. Wire body MUST
  stay byte-identical: `{ error: "A camp with this ID already exists" }`
  (legacy admin form pattern-matches it — message-preserving like
  `CampHasActiveAnimalsError`).

EDIT:
- `lib/domain/camps/index.ts` — export `createCamp`, `CreateCampInput`,
  `CreateCampResult`, `MissingSpeciesError`, `MISSING_SPECIES`,
  `DuplicateCampError`, `DUPLICATE_CAMP`. Update the leading docstring.
- `lib/server/api-errors.ts` — add a camps arm: `MissingSpeciesError` →
  422 `{ error: "MISSING_SPECIES" }`; `DuplicateCampError` → 409
  `{ error: err.message }`. Follow the existing camps `CampHasActiveAnimalsError`
  arm style exactly.
- `app/api/camps/route.ts` — POST body becomes a thin `adminWrite` adapter:
  keep `createCampSchema` + revalidate; `const result = await
  createCamp(ctx.prisma, body); return NextResponse.json(result, { status:
  201 });`. Map the thrown domain errors via the adapter's normal
  `mapApiDomainError` path (do NOT hand-roll status codes in the route).
  GET unchanged except the one-line "stays thin by design" comment.

NEW `lib/domain/camps/__tests__/create-camp.test.ts` — RED-first. Cover:
missing-species throws `MissingSpeciesError`; duplicate (species-scoped)
throws `DuplicateCampError`; colour auto-assign uses palette modulo on
`count`; explicit colour passes through; happy-path returns the exact
snake_case shape with `animal_count: 0`. Use a minimal prisma double.

## Audit baseline relocation — MANDATORY (read carefully)

Moving the two `prisma.camp` call-sites OUT of `app/api/camps/route.ts`
breaks the path-keyed `.audit-species-where-baseline.json`. On origin/main
these two entries exist (lines ~61-62):

```
"app/api/camps/route.ts::camp::count::0",
"app/api/camps/route.ts::camp::findFirst::0",
```

You MUST do a **surgical remove-old + add-new** edit of
`.audit-species-where-baseline.json`:
- Remove both `app/api/camps/route.ts::camp::*` entries (they go dead).
- Add the new-path keys for `lib/domain/camps/create-camp.ts`.
- **Do NOT guess the new keys.** Get them by running
  `pnpm tsx scripts/audit-species-where.ts` (or `npx tsx ...`) AFTER the
  code move — it prints the exact offender keys for the new file. Use
  those literal strings. The key format is
  `path::model::operation::occurrenceIndex`.
- Preserve the file's existing alphabetical / array ordering and JSON
  formatting (2-space indent, trailing structure) byte-for-byte except the
  two-line swap.
- **NEVER run `--write-baseline`** — it also drops unrelated stale entries
  (out of scope) and would mask real new offenders.
- Re-run `scripts/audit-species-where.ts` to **0 new offenders** with the
  edited baseline before committing.

Camps route has NO `findMany` → `.audit-findmany-baseline.json` and
`.audit-findmany-no-select-baseline.json` are NOT affected by 316a. Confirm
by running those scripts too (must be 0 new offenders, baselines
unchanged).

## File allow-list (do NOT touch anything else)

- NEW `lib/domain/camps/create-camp.ts`
- NEW `lib/domain/camps/__tests__/create-camp.test.ts`
- `lib/domain/camps/errors.ts`
- `lib/domain/camps/index.ts`
- `lib/server/api-errors.ts`
- `app/api/camps/route.ts`
- `.audit-species-where-baseline.json` (the surgical 2-line swap only)
- NEW `tasks/wave-316a-camps-create-domain.md` (this file)

## Acceptance

1. `rm -rf .next/cache/tsbuildinfo .tsbuildinfo && npx tsc --noEmit` clean
   (zero-diff vs origin/main for any incidental noise).
2. `pnpm vitest run` fully green — new create-camp test + any existing
   camps/api-errors tests.
3. All `scripts/audit-*.ts` report **0 new offenders**;
   `.audit-species-where-baseline.json` shows ONLY the 2-line camps→domain
   swap in `git diff`; the other two baselines are byte-identical.
4. `pnpm build --webpack` green.
5. `git diff origin/main -- app/api/camps/route.ts` shows the POST handler
   reduced to a thin adapter and GET unchanged (bar the one-line comment);
   no wire-shape or status-code change anywhere.

## Out of scope

- GET extraction (intentionally stays a thin cached delegate).
- Any wire/status/body change. `MISSING_SPECIES` 422 and the duplicate 409
  free-text body are preserved byte-identical.
- `app/api/animals/route.ts` (that is Wave 316b).
- `--write-baseline` on any audit baseline.
