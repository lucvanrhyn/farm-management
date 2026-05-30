# Per-observation-type `details` validation: a schema registry in the write door

**Status:** Accepted (2026-05-29) — approved by Luc (#494, PRD #479 Epic C Phase 2); implementation tracked as #513

> This ADR is the deliverable for acceptance criteria 1 & 2 of #494 (registry
> shape + first-adopter scope). Acceptance criteria 3 & 4 (migrating the
> validators onto the registry, no behavioural regression) ship in a dedicated
> follow-up wave tracked as **#513** — this ADR records the approved design only.
> No runtime code changes ship with this ADR.

## Context

An `Observation` row carries a `details` column: a non-nullable `String` that
holds a `JSON.stringify`-ed, per-type payload (`{ weight_kg }` for a weighing,
`{ cause, carcassDisposal }` for a death, `{ grazing, water, fence }` for a
camp condition, …). The shape of that JSON is entirely implicit — the column is
a string, and what is *inside* the string is whatever the form for that
observation type happened to emit. There is no schema binding `type` to the
structure of its `details`.

### The current ad-hoc per-type validation

Four independent validations have grown up around this column, each defending a
different observation type, each hand-rolled, and each wired in a different
place:

| Type | Validator | Where it runs | Error code(s) | Error mapped via |
| --- | --- | --- | --- | --- |
| `camp_condition` | `assertCampConditionComplete` (`lib/domain/observations/create-observation.ts:175`) | **inside the door** (`create-observation.ts:328`) | `CAMP_CONDITION_FIELD_REQUIRED` (422) | `mapApiDomainError` |
| `weighing` | `validateWeighingObservation` (`lib/server/validators/weighing.ts:116`) | **inside the door** (`create-observation.ts:407`) | `WEIGHT_OUT_OF_RANGE` (422) | `mapApiDomainError` |
| `death` | `validateDeathObservation` (`lib/server/validators/death.ts:157`) | **in the route handler** (`app/api/observations/route.ts:181`) | `DEATH_MULTI_CAUSE` / `DEATH_DISPOSAL_REQUIRED` (422) | inline `routeError(err.code, …, 422)` |
| `heat_detection`, `pregnancy_scan`, `insemination`, `body_condition_score`, `temperament_score`, `calving` | `validateReproductiveState` (`lib/server/validators/reproductive-state.ts:289`) | **in the route handler** (`app/api/observations/route.ts:162`) | `REPRO_MULTI_STATE` / `REPRO_REQUIRED` / `REPRO_FIELD_REQUIRED` (422) | inline `routeError(err.code, …, 422)` |

Every one of these reimplements the same `coerceDetails(details: unknown)`
helper verbatim (`death.ts:84`, `reproductive-state.ts:131`, `weighing.ts:67`)
to tolerate the JSON-string-or-object ambiguity, then hand-walks the fields.
The pattern is consistent — a typed error class carrying a SCREAMING_SNAKE
`code`, a no-op for non-matching types — but it is *convention*, not structure.
There is no single place where "the rules for a `weighing`'s details" live, and
adding a new typed observation means cloning the whole apparatus again.

The placement is also split: `camp_condition` and `weighing` validate **inside**
`createObservation` (so a duplicate bad payload is rejected before the
idempotency upsert, never stored), while `death` and `repro` validate **in the
route handler** *before* the door is even called. The route-handler validators
therefore do **not** protect the other observation-write entry points
(`lib/domain/tasks/update-task.ts` and `lib/domain/mobs/move-mob.ts` both call
`createObservation` directly per ADR-0006) — a `death` row written through one
of those paths skips `validateDeathObservation` entirely. The door is the only
chokepoint that sees every write (ADR-0006's whole point), so the door is where
per-type validation *should* live.

### The B2 malformed-`details` 500 (now a clean 400 via #484)

`details` is persisted via `details ?? ""` into a non-nullable `String` column.
Before #484, a non-string `details` (an object, a number, an array) sailed past
the wire schema and threw a `PrismaClientValidationError` → an opaque 500. #484
closed that by shape-checking at the wire boundary
(`createObservationSchema.parse`, `route.ts:80`): `details` must be a string or
absent. That is a *type* gate (`typeof === "string"`), not a *structure* gate —
it stops "details is an object" but says nothing about whether the string, once
parsed, is the right shape for its `type`. A registry generalises B2 from
"reject non-strings" to "reject any `details` that does not match the schema
registered for this `type`" — making the structural guarantee per-type rather
than a single blanket string-check.

### The completeness-critic insight

The PRD #479 completeness critic surfaced that all four validators above are
special cases of one general operation: *given a `type` and a `details` string,
assert that the parsed payload conforms to the contract for that type.* C1 (the
weight validator, #487) is the most recent clone; B2 is the structural floor;
the camp/death/repro validators are the same shape with different field rules.
A per-type schema registry is the convergence: declare the contract once per
type, validate uniformly in the door.

### Notes are out of scope (reconciling the issue text)

The original #494 description mentions giving "the free-text-notes backlog (I1)
a typed home." That line **predates** the Path A decision: #492 shipped `notes`
as a first-class `String?` column on `Observation`, sanitised by `sanitizeNote`
(`create-observation.ts:86`) and written on the create side of the upsert only.
Free-text notes are deliberately *cross-cutting* — a farmer can attach a note to
any observation type, independent of the structured `details` payload. They are
**not** part of any per-type `details` schema and this registry does not touch
them. This ADR is for the per-type **structured** `details` fields only.

### Prior art: does the repo use Zod?

**No.** There is no `zod` entry in `package.json` and zero `from "zod"` imports
anywhere in the tree (verified 2026-05-29). Every existing validator explicitly
documents this and matches the house "hand-rolled `parse()`" style — see the
`reproductive-state.ts:26` docstring ("Why a hand-rolled validator instead of
`zod`: The repo doesn't carry a `zod` runtime dep yet…"), echoed verbatim in
`death.ts:6` and `weighing.ts:6`. The wire-boundary `createObservationSchema`
(`route.ts:65`) is itself a duck-typed `{ parse(input): … }` object, not a Zod
schema.

So "Zod registry" in the issue title is a **proposal to introduce a new runtime
dependency**, not a request to reuse existing prior art — and this ADR must own
that decision rather than wave at precedent. Two facts make the cost small and
the fit natural, though:

- The typed-error envelope was *designed* around Zod's output shape. The
  envelope minter docstring (`lib/server/route/envelope.ts:13`) names
  "structured field-level info (e.g. zod issues)" as the model for the
  `details` field, and the `tenantWrite` adapter already duck-types a Zod-style
  error: `extractDetails` reads `"issues" in err` and forwards
  `{ issues }` to the envelope (`lib/server/route/tenant-write.ts:36-40`). A
  thrown `ZodError` would flow into the existing 400 `VALIDATION_FAILED`
  envelope **with no adapter change** and richer field-level `details` than the
  current single-message throw.
- Zod gives us, for free, the three things the hand-rolled validators each
  reimplement: a declarative shape, a parse-or-throw entry point, and a
  structured issue list. The registry is the natural home for it.

`CONTEXT.md` ("Observation writes", "the `details` payload") pins the
vocabulary this ADR uses.

## Decision

Introduce a **per-observation-type `details` Zod schema registry**, consulted
inside `createObservation` **before the idempotency upsert** (and inside the
edit door, `updateObservation`, before its persist). One declarative schema per
typed observation; one uniform validation call; one typed error envelope.

Concretely:

1. **Add `zod` as a runtime dependency.** The first dependency that pays for
   itself: it replaces (does not augment) the three standalone `lib/server/validators/*`
   modules and the inline camp-condition guard with declarative schemas, and it
   slots into the envelope plumbing that was already designed for it.

2. **Declare a registry** keyed by the canonical `ObservationType` strings
   (`lib/domain/observations/registry.ts:62`), mapping each typed observation to
   the Zod schema for its `details` payload.

3. **Validate in the door, before the upsert.** `createObservation` looks the
   incoming `type` up in the registry and, if a schema is registered, parses the
   `details` string through it. This replaces the four ad-hoc call sites and
   moves the two route-handler validators (death, repro) into the door, so every
   write entry point (route, `move-mob`, `update-task`) is covered identically.

4. **Map failure to the canonical envelope** via a single typed error
   (`DetailsValidationError`) carrying the Zod issue list, routed through
   `mapApiDomainError`.

## Registry shape

### Where it lives

A new module `lib/domain/observations/details-schemas.ts`, co-located with the
write door and the type registry it keys off. It imports `ObservationType` from
`./registry` so the registry key set is bound to the single source of truth for
valid types (the same `OBSERVATION_TYPE_LIST` that backs the persistence
allowlist).

### How a per-type schema is declared and looked up

A partial record keyed by `ObservationType`. "Partial" is load-bearing: most of
the 23 types carry free-form `details` today and will not gain a schema in the
first wave (see Scope below), so the registry maps only the *typed* subset.

```ts
// lib/domain/observations/details-schemas.ts
import { z } from "zod";
import type { ObservationType } from "./registry";

/** A schema that validates the PARSED details object for one observation type. */
export type DetailsSchema = z.ZodType<unknown>;

/**
 * Registry of per-type details schemas. A type ABSENT from this map has no
 * structured contract yet — its details pass through unvalidated (see
 * "Unknown / unregistered type" below).
 */
export const DETAILS_SCHEMAS: Partial<Record<ObservationType, DetailsSchema>> = {
  weighing: z.object({
    // canonical key is weight_kg; weightKg tolerated for historical drift
    weight_kg: z.coerce.number().finite().positive(),
  }).passthrough(),
  // death, camp_condition, repro types … (see Migration path)
};

export function getDetailsSchema(type: string): DetailsSchema | undefined {
  return DETAILS_SCHEMAS[type as ObservationType];
}
```

Two shape notes:

- **`.passthrough()` (not `.strict()`).** A registered schema asserts the
  *required* fields are present and well-typed; it must NOT reject extra keys.
  The persisted `details` already carries provenance keys the schemas don't
  model (`logged_by` on camp_condition, `mob_id`-derived fields on movements,
  client metadata). `.strict()` would turn every such key into a regression.
  This is the conservative choice that preserves behaviour.
- **`z.coerce` for the JSON-string ambiguity.** The offline-sync queue
  `JSON.stringify`s the whole payload, so a numeric field can arrive as
  `"412"`. The hand-rolled `parseWeight` (`weighing.ts:93`) already coerces;
  `z.coerce.number()` reproduces that exactly, so a string-encoded number still
  validates.

The door first parses the `details` string into an object (reusing the single
shared `coerceDetails` the validators duplicate today — lifted into this module
as the one canonical copy), then hands the object to the registered schema.

### Unknown / unregistered type: **pass-through (recommended)**

A `type` with no registered schema validates as a **no-op** — its `details`
flows through untouched. Rationale:

- It mirrors today's behaviour exactly: an untyped observation (`treatment`,
  `general`, `dosing`, …) has no structured contract now and gains none until a
  schema is deliberately written for it. Pass-through is the zero-regression
  default and the only choice compatible with "no behavioural regression for
  existing valid payloads" (#494 acceptance criterion 4).
- The *type allowlist* is a separate, already-structural guard:
  `InvalidTypeError` (`create-observation.ts:322`) rejects unknown type strings
  before the registry is ever consulted. So "unregistered" here always means "a
  *valid* type that simply has no structured-details schema yet" — never an
  arbitrary attacker string. Rejecting it would break every untyped type.
- B2's structural floor still holds independently: the #484 wire-schema string
  check (`route.ts:80`) rejects non-string `details` for *all* types regardless
  of registry membership. The registry deepens the guarantee for registered
  types; it does not weaken it for the rest.

(Reject-by-default — requiring every type to have a schema — is the long-term
end state once all 23 types are modelled, but adopting it now would force 19
schemas in one wave and is explicitly out of scope. Revisit in a follow-up ADR
when registry coverage approaches 100%.)

### Error mapping: **one canonical code (recommended), per-type codes preserved during migration**

The end-state recommendation is a single canonical error:

```ts
export const DETAILS_VALIDATION_FAILED = "DETAILS_VALIDATION_FAILED" as const;

export class DetailsValidationError extends Error {
  readonly code = DETAILS_VALIDATION_FAILED;
  readonly issues: z.ZodIssue[];
  constructor(issues: z.ZodIssue[]) {
    super("Observation details failed validation.");
    this.name = "DetailsValidationError";
    this.issues = issues;
  }
}
```

mapped in `mapApiDomainError` to a 422 envelope that forwards the Zod issue
list (never raw user text beyond the issue paths/codes — audit-error-envelope
clean):

```ts
if (err instanceof DetailsValidationError) {
  return NextResponse.json(
    { error: err.code, details: { issues: err.issues } },
    { status: 422 },
  );
}
```

This is strictly richer than today's single-message throws (the UI gets a
field-level issue list), routes through the same `mapApiDomainError` chokepoint
all the door's other errors use, and collapses the five-code zoo
(`DEATH_MULTI_CAUSE`, `REPRO_FIELD_REQUIRED`, `WEIGHT_OUT_OF_RANGE`, …) into one.

**But** those five codes are part of the live wire contract — the offline-sync
`isTerminalStatus` classifier, `FailedSyncDialog`, and the existing validator
test suites (`__tests__/api/observations/death-validator.test.ts`, the repro and
weight suites) all assert on the specific strings. Switching them all at once is
exactly the kind of cross-client break #494 criterion 4 forbids. The
recommendation is therefore **two-phase**:

- **During migration:** preserve each per-type code. The registry's schema for a
  type carries a small mapping (or a `.refine`/`superRefine` with a custom
  `code`) so a failed `weighing` parse still surfaces `WEIGHT_OUT_OF_RANGE`, a
  failed `death` parse still surfaces `DEATH_DISPOSAL_REQUIRED`, etc. Wire shape
  byte-identical → zero client/test churn. This is the same "reproduce the
  pre-extraction wire literal byte-identical" discipline ADR-0001 Wave B used
  when relocating the animals route logic.
- **After migration, as a separate decision:** introduce
  `DETAILS_VALIDATION_FAILED` as the canonical code for *new* typed schemas, and
  migrate the legacy codes to it only with explicit client/offline-sync sign-off
  (a follow-up issue, not this wave).

## Migration path (deferred — ships only after sign-off)

The migration is behaviour-preserving by construction: each validator's existing
test suite is the regression gate, and the wire codes are preserved (above).
Per-type, in dependency order:

1. **`weighing` (already in the door).** Lowest risk — it already validates
   inside `createObservation` before the upsert (`create-observation.ts:407`),
   already maps via `mapApiDomainError`. Write
   `DETAILS_SCHEMAS.weighing = z.object({ weight_kg: z.coerce.number().positive().max(speciesMax) }).passthrough()`.
   The species-derived `speciesMax` is **dynamic** (resolved from the
   species-stamping waterfall at `create-observation.ts:408`), so this schema is
   *parameterised*: the registry entry is a `(speciesMax) => ZodSchema` factory,
   or the door applies a `.max()` refinement after lookup. Either way the
   schema's `.refine` re-throws `WeightOutOfRangeError` so the
   `WEIGHT_OUT_OF_RANGE` code and its existing test suite are untouched. Confirm
   green, delete `lib/server/validators/weighing.ts`.

2. **`camp_condition` (already in the door).** `assertCampConditionComplete`
   (`create-observation.ts:175`) becomes
   `z.object({ grazing: z.string().min(1), water: z.string().min(1), fence: z.string().min(1) }).passthrough()`,
   re-throwing `CampConditionFieldRequiredError` with the offending `field` so
   the `CAMP_CONDITION_FIELD_REQUIRED` + `{ field }` envelope is preserved. NB:
   the byte-identical-duplicate guard `assertNotDuplicateCampCondition`
   (`create-observation.ts:221`) is **not** a details-shape check — it stays as
   a separate door step; the registry only subsumes the completeness assertion.

3. **`death` (move from route into door).** Port `validateDeathObservation`
   (`death.ts:157`) — the single-cause + valid-`carcassDisposal`-enum rule — to
   a schema re-throwing `DeathMultiCauseError` / `DeathDisposalRequiredError`.
   Then **delete the route-handler block** (`route.ts:181-193`) so death is
   validated in the door instead. This is the step that *fixes* the
   `move-mob`/`update-task` coverage gap. Pin the `CARCASS_DISPOSAL_VALUES`
   enum-lock test (`death.ts:48`).

4. **Repro family (move from route into door).** Port `validateReproductiveState`
   (`reproductive-state.ts:289`) — the per-type state-count / required-field
   rules for the six repro types — to per-type schemas re-throwing
   `ReproMultiStateError` / `ReproRequiredError` / `ReproFieldRequiredError`.
   This is the largest validator (six types, multi-state counting, score
   bounds); it migrates last, one repro sub-type at a time, each gated on its
   slice of the existing repro test suite. Delete the route-handler block
   (`route.ts:161-172`) once all six are registered.

5. **Cleanup.** Once all four are migrated: the three `lib/server/validators/*`
   modules are deleted, the route handler's import block (`route.ts:31-41`) and
   the two inline try/catch blocks vanish (the door now owns it all), and a
   structural test (cloned from ADR-0006's
   `observation-write-no-direct-callers.test.ts`) can assert that no per-type
   validation lives outside `details-schemas.ts` — making "added a type-specific
   validator in the wrong place" a CI error rather than a convention.

**Validation placement invariant (load-bearing):** the registry lookup + parse
runs in `createObservation` **after** the species-stamping waterfall (so a
species-dependent schema like `weighing`'s `max` has the species) and **before**
the idempotency upsert (`create-observation.ts:424`), mirroring exactly where
#487's weight gate sits today. A duplicate bad payload must be rejected, never
stored — the same reason `assertNotDuplicateCampCondition` and the weight gate
already run pre-upsert.

## Scope decision — first adopters

**Recommendation: adopt the three types that already have standalone validators
(`weighing`, `death`, `camp_condition`) plus the six repro types — i.e. exactly
the set already validated today — and nothing more in the first wave.**

Justification:

- These nine types are the *only* ones with an existing structured-details
  contract. Their rules are already specified, already tested, and already
  enforced — porting them onto the registry is a pure refactor with the existing
  test suites as the regression gate, not new product behaviour. That is the
  safest possible first wave and directly satisfies #494 criterion 4.
- The other ~14 types (`treatment`, `general`, `dosing`, `shearing`, `weaning`,
  `mob_movement`, `game_*`, …) carry free-form or no structured `details` today.
  Writing schemas for them is *new* validation behaviour with no existing
  spec — it belongs in its own product-decision wave, not bundled into a
  refactor. Pass-through (above) covers them safely in the interim.
- **Sequencing within the wave:** migrate in the order
  `weighing` → `camp_condition` → `death` → repro family. The first two already
  live in the door (lowest risk, proves the registry mechanism). `death` and the
  repro family additionally *relocate* from the route handler into the door —
  more moving parts — so they come last, and the repro family (six types) is
  split sub-type-by-sub-type.

## Consequences

### Pros

- **B2 becomes structural and per-type.** The malformed-`details` guard graduates
  from "#484's blanket string check" to "the parsed payload matches the schema
  registered for this type." Wrong-shape details for a registered type fail with
  a typed 422 + field-level issues instead of slipping through to analytics.
- **C1 generalised.** The weight validator (and death, repro, camp) stop being
  bespoke clones; adding a new typed observation is "register a schema," not
  "clone the validator + coerceDetails + error class + route wiring."
- **Single chokepoint.** Moving death/repro into the door closes the real bug
  that they're currently bypassed by the `move-mob` / `update-task` write paths
  (ADR-0006's other two door callers). Every write is validated identically.
- **Uniform, richer typed errors.** All per-type failures route through
  `mapApiDomainError` (death/repro stop being inline route exceptions), and the
  envelope gains a structured Zod issue list — which the envelope and
  `tenantWrite` adapter were already built to carry.
- **AI-navigability.** A future agent (or the Farm Einstein RAG layer) can read
  one declarative file to learn the contract for every typed observation,
  instead of reverse-engineering four hand-rolled validators in three locations.

### Cons / risks

- **New runtime dependency.** Zod is a real (if small, tree-shakeable) addition
  to a codebase that has so far avoided it on purpose. Mitigation: it *replaces*
  three validator modules + an inline guard, so net hand-rolled-validation code
  drops; and it's the standard, well-audited choice.
- **Error-code compatibility.** The five live wire codes are an offline-sync /
  client contract. Mitigation: preserve them per-type during migration (above);
  the canonical-code switch is a separate, signed-off follow-up.
- **Migration churn + the dynamic-`speciesMax` wrinkle.** `weighing`'s ceiling
  is species-dependent, so its registry entry can't be a static schema — it's a
  factory or a post-lookup refinement. This is a known shape, not a blocker, but
  it means the registry value type must accommodate "schema or schema-factory."
- **Repro is genuinely complex.** The multi-state counting and per-sub-type
  required-field logic (`reproductive-state.ts`) is the hardest to express
  declaratively; some of it will live in `superRefine` rather than plain object
  shape. Budget for it landing last and incrementally.

### Explicitly: replace, do not run alongside

The registry **replaces** the standalone validators incrementally — it does
**not** run as a second validation layer on top of them. Each migration step
deletes the validator it ports (or removes its route-handler call) in the same
change that registers the schema. Running both would double-validate, risk
divergent error codes for the same payload, and defeat the single-source-of-truth
goal. The end state is: zero `lib/server/validators/*` observation modules, zero
inline per-type validation in the route handler, one `details-schemas.ts`.

## Status

**Accepted (2026-05-29).** Approved by Luc per the #494 acceptance gate and the
arch-PR sign-off exception in `CLAUDE.md` (architectural / ADR PRs need explicit
promote sign-off). Implementation — acceptance criteria 3 & 4 — is tracked as a
dedicated follow-up wave (#513) and ships per the migration path above, off a
`wave/<NNN>-details-zod-registry` branch.

### Implementation notes (#513 — wave/513-details-zod-registry)

The registry shipped as `lib/domain/observations/details-schemas.ts` (the ADR's
proposed `registry.ts`-sibling location — co-located with the write door and the
`ObservationType` registry it keys off, NOT under `lib/server/`). All nine
first-adopter types are registered; the ~14 free-form types pass through. `zod`
(`^4.3.6`) was added as the first runtime dep.

Decisions taken during implementation (worth a reviewer's eye):

- **Wire codes preserved byte-identically.** Each migrated family re-throws its
  legacy typed error (`WeightOutOfRangeError`, `Death{MultiCause,DisposalRequired}Error`,
  `Repro{MultiState,Required,FieldRequired}Error`, `CampConditionFieldRequiredError`)
  rather than the canonical `DetailsValidationError`. `DETAILS_VALIDATION_FAILED`
  /`DetailsValidationError` ship as the home for FUTURE typed schemas only; the
  legacy-code → canonical switch remains the separate, signed-off follow-up the
  ADR describes. The Zod schemas back the shape; the door-facing
  `validateObservationDetails(type, details, { speciesMax })` translates a parse
  failure into the legacy error.
- **`weighing` is a `(speciesMax) => schema` factory** (`weighingDetailsSchema`),
  resolved in the door from the species-stamping waterfall.
- **camp_condition kept as a dedicated EARLY door step** (before the timestamp
  parse + duplicate guard + camp-existence check), now calling
  `validateCampConditionComplete`. This preserves the exact pre-ADR ordering: an
  incomplete payload still fails with `CAMP_CONDITION_FIELD_REQUIRED` and is
  never masked by a later `CampNotFoundError` or a wasted duplicate-guard query.
  All other typed families validate via the single post-waterfall
  `validateObservationDetails` call.
- **death + repro relocated route → door**, closing the `move-mob` /
  `update-task` coverage gap (ADR-0006's other door callers). The two
  route-handler try/catch blocks in `app/api/observations/route.ts` are gone;
  the door throws and `mapApiDomainError` maps the death/repro errors to their
  byte-identical 422 envelopes (new arms added there — same `routeError(code,
  message, 422)` minter the route used).
- **Edit door (`updateObservation`) now validates ALL registered types**, not
  just `weighing` (ADR §Decision: "and inside the edit door … before its
  persist"). Behaviour for `weighing` is unchanged; editing a `death` / repro
  row into an invalid payload is now rejected at the edit boundary too. No
  existing test edited such a row expecting success, so this is a strict
  strengthening consistent with the ADR's single-chokepoint goal.
- **Structural test** `__tests__/architecture/observation-details-validation-single-home.test.ts`
  (cloned from ADR-0006's `observation-write-no-direct-callers.test.ts`) makes
  re-defining a per-type validator / `coerceDetails` / typed-error class outside
  the registry a CI error.
- The three `lib/server/validators/{weighing,death,reproductive-state}.ts`
  modules are **deleted** (zero validator modules remain, per §Consequences).
