# FarmTrack — Domain Vocabulary

This file captures the precise meaning of terms used across FarmTrack code,
docs, and reviews. New PRDs append sections; existing sections are revised
in-place when a term's meaning changes. Architectural decisions live in
`docs/adr/`.

Single-context: `CLAUDE.md` is the authoritative agent-instruction file.
`CONTEXT.md` is read-only background for grilling/design sessions — it does
not override `CLAUDE.md`.

---

## Sync (offline queue)

PRD #194 introduces a typed facade (`lib/sync/queue.ts`) over the offline
sync subsystem. The terms below pin the contract so future callers cannot
re-introduce the caller-must-remember class of bug that broke the "last
synced" indicator twice (Codex audit C1 and C3).

### Sync kind

One of four typed offline-queue domains: `observation`, `animal`, `photo`,
`cover-reading`. Each kind has its own IndexedDB object store
(`pending_observations`, `pending_animal_creates`, `pending_photos`,
`pending_cover_readings`), its own server endpoint, and its own per-row
sync state machine. The facade dispatches on a `SyncKind` token so a single
coordinator can drive all four uniformly.

### Sync truth

The canonical `SyncTruth` record returned by `getCurrentSyncTruth()`. Shape:
`{ pendingCount, failedCount, lastAttemptAt, lastFullSuccessAt }`. The UI
MUST read this record — never the underlying IDB getters
(`getPendingCount`, `getLastSyncedAt`, etc.) — because the consistency of
the four fields is enforced only by this function. Reading the underlying
getters and assembling them in the UI is the exact pattern that produced
C1/C3.

### Sync attempt

A single coordinator cycle — one invocation of `syncAndRefresh`. The
coordinator processes all four kinds (in parallel for the three direct
kinds; photos run after observations resolve their server IDs), then emits
exactly one `recordSyncAttempt({ timestamp, perKindResults })` call. That
call is the ONLY place `lastAttemptAt` and `lastFullSuccessAt` can move.

### Last full success

The `lastFullSuccessAt` field of `SyncTruth`. Derived field — ticks only
when the most recent `recordSyncAttempt` had `failed === 0` for every kind.
A partial-success cycle (e.g. observations all-synced but one photo failed)
does NOT tick this field, even though it ticks `lastAttemptAt`. This is the
truthfulness invariant: the UI "Synced just now" badge is the user's
guarantee that everything they queued reached the server.

### Sync failure (row-level)

A `SyncFailure` record — `{ reason, attempts, lastAttemptAt }` — describing
why a single queued row failed. Wave 1 (PRD #194 slice 1/3) defines the
type but does not yet thread per-row reasons through the four pending
stores; wave 2 (issue #196) wires it in and migrates UI consumers.

---

## Species scoping

ADR-0005 makes the species axis on the four species-bearing models
(`Animal`, `Camp`, `Mob`, `Observation`) reachable only through two
*named doors*, so the type system can distinguish the two opposite
intents the old `audit-species-where` baseline could not. The terms
below pin that contract.

### Per-species surface

A read or set-spanning mutation whose result MUST be limited to the
active FarmMode species (the `farmtrack-mode-<slug>` cookie resolved via
`getFarmMode(slug)`). Admin tables, dashboards, mob pickers, the logger
camp tiles. An unscoped query on a per-species surface is the
"silently leak every species onto the cattle dashboard" bug class —
the reason the `scoped()` facade (#224) exists.

### Cross-species access

A read that MUST intentionally span every species — Farm Einstein RAG,
farm-wide analytics roll-ups, notification crons, the `lib/species`
registry's own internals. Scoping a cross-species access to one mode is
the *inverse* bug (a farm-wide audit log that silently drops sheep).
"Per-species surface" and "cross-species access" are mutually
exclusive and exhaustive for any tenant read of the four models.

### Species scope (`scoped`)

The named door for per-species surfaces: `scoped(prisma, mode)`
(`lib/server/species-scoped-prisma.ts`). `mode: SpeciesId` is a required
positional argument — omitting it is a compile error. Injects
`{ species: mode }` (plus `status: ACTIVE_STATUS` on animal reads) with
caller keys winning the merge.

### Cross-species door (`crossSpecies`)

The named door for cross-species access: `crossSpecies(prisma, reason)`.
`reason` is a typed union of sanctioned purposes (e.g.
`'einstein-rag' | 'analytics-rollup' | 'notification-cron' |
'farm-wide-audit' | 'species-registry-internal'`) — NOT a free string —
so the classification lives in the type system, not in a JSON baseline.
Injects no species predicate. A site that needs cross-species access
without a sanctioned reason is a design question, not a pragma.

### Species access invariant

The four species models may be reached on a tenant code path ONLY via
`scoped()` or `crossSpecies()`. Raw `prisma.{animal,camp,mob,observation}`
is forbidden outside a small *structural* exemption (the two door
modules themselves, `migrations/`, `scripts/` seed/maintenance, `prisma/`,
test files). Enforced by a structural architecture test in the shape of
`__tests__/architecture/sync-truth-no-direct-callers.test.ts`
(ADR-0002's invariant) — presence of a named door, NOT presence of a
`species:` key. There is no per-call baseline and no
`audit-allow-species-where:` pragma; both are retired by ADR-0005's
final rollout wave.

---

## Observation writes

ADR-0006 makes `Observation` creation reachable only through a single
named door so the species-stamping invariant ADR-0004 §4 declares cannot
be re-broken at a new write site. The terms below pin that contract.
The door is the *write* counterpart to ADR-0005's two *read* doors;
they cite each other and stay distinct so the filter/data confusion the
species-scoped facade header warns about is never reintroduced.

### Observation write door (`createObservation`)

The single named door for observation creation:
`createObservation(client, input)` (`lib/domain/observations/create-observation.ts`).
`client` is typed as `ObservationWriter` — the union of `PrismaClient`
and the transaction-callback client returned by `prisma.$transaction`'s
inner type — so the door is callable both inline and inside a
`$transaction` block (the load-bearing case for mob-movement and
task-completion writes, which must be atomic with their sibling
mutations).

### Observation write invariant

`Observation` may be created on a tenant code path ONLY via
`createObservation`. Raw `prisma.observation.create` /
`tx.observation.create` is forbidden outside a *structural* exemption
(the door module itself, `migrations/`, `prisma/`, `scripts/` seed and
maintenance, test files). Enforced by an architecture test in the same
shape as ADR-0002's `sync-truth-no-direct-callers.test.ts` and
ADR-0005's `species-access-no-direct-prisma.test.ts` — presence of the
door, not presence of a `species:` key on the call.

### Species-stamping waterfall

The rule the door uses to populate `Observation.species` (ADR-0004 §4 —
species is denormalised onto the row at write time so per-species
filters hit the covering index without a JOIN):

1. `animal_id` supplied → animal's species. Throws `AnimalNotFoundError`
   if the lookup fails (an FK violation, not a legitimate null).
2. Else `mob_id` supplied → mob's species. Throws `MobNotFoundError`
   on lookup miss.
3. Else if the resolved camp carries a species → camp's species.
4. Else → `null`. Back-compat for legacy camp-only observations on
   single-species data; once the backfill audit (`scripts/audit-observation-species.ts`)
   confirms zero NULL rows in prod the read side drops its
   NULL-tolerant predicate (ADR-0004 §5 closure).

The waterfall is "most-specific source wins." Disagreement between
layers (e.g. an animal's species ≠ its mob's species) is a schema
invariant, enforced by tests — not a runtime cost on every write. The
pre-ADR-0006 fallback (`animal?.species ?? null` on a missing-animal
read) silently wrote NULLs that the species-scoped read predicate's
OR-branch had to tolerate; the throw closes that hole.
