# Wave 156 — Observations domain extraction + adapter migration

Closes #156. Third wave in ADR-0001 rollout (Wave A = #149, Wave B = #153).

## Goal

Migrate the four `app/api/observations/**` route files onto the Wave A
transport adapters and extract their per-route business logic into pure
domain operations under `lib/domain/observations/`. After this wave, the
four `observations/*` entries come out of the EXEMPT set in the
`route-handler-coverage` invariant. Concurrently re-home the orphaned
`lib/server/mob-move.ts` into `lib/domain/mobs/` so all domain ops live
under one root.

## Architecture (mirrors Wave B mobs)

Six pure domain ops, one per logical operation:

| Op | File | Adapter | Calls into |
|---|---|---|---|
| `listObservations(prisma, filters)` | `lib/domain/observations/list-observations.ts` | `tenantRead` | `prisma.observation.findMany` |
| `createObservation(prisma, input)` | `lib/domain/observations/create-observation.ts` | `tenantWrite` | `prisma.camp.findFirst` + `prisma.animal.findUnique` + `prisma.observation.create` |
| `updateObservation(prisma, input)` | `lib/domain/observations/update-observation.ts` | `adminWrite` | `prisma.observation.findUnique` + `prisma.observation.update` |
| `deleteObservation(prisma, id)` | `lib/domain/observations/delete-observation.ts` | `adminWrite` | `prisma.observation.findUnique` + `prisma.observation.delete` |
| `resetObservations(prisma)` | `lib/domain/observations/reset-observations.ts` | `adminWrite` | `prisma.observation.deleteMany` |
| `attachObservationPhoto(prisma, input)` | `lib/domain/observations/attach-photo.ts` | `tenantWrite` | `prisma.observation.findUnique` + `prisma.observation.update` |

Each op accepts `(prisma, input)`, returns plain JSON-serialisable
data, and throws typed errors for business-rule failures:
`ObservationNotFoundError`, `CampNotFoundError`, `InvalidTypeError`,
`InvalidTimestampError`. The adapter envelope maps these via
`mapApiDomainError`.

## Mob-move re-home (preflight)

`lib/server/mob-move.ts` was the half-extracted helper that ADR-0001
cited as a precedent for the three-layer split. Wave B left it in place
for scope; Wave C re-homes it to `lib/domain/mobs/move-mob.ts` before
the observations work so all domain ops live under one root. Behavioural
change: zero. Importers (4 prod modules + 6 tests) re-pointed.

## Wire-shape contract

Typed business errors flow through `mapApiDomainError`, which mints
`{ error: CODE }` JSON at the documented status. Validation errors
(missing required fields, malformed schema) flow through the
`tenantWrite`/`adminWrite` schema-parse path and surface as
`{ error: "VALIDATION_FAILED", message, details: { fieldErrors } }`.

| Code | Status | Meaning |
|---|---|---|
| `INVALID_TYPE`        | 422 | observation type not in allowlist |
| `CAMP_NOT_FOUND`      | 404 | camp_id does not match any tenant camp |
| `INVALID_TIMESTAMP`   | 400 | created_at not parseable |
| `OBSERVATION_NOT_FOUND` | 404 | id mismatch on update/delete/attach |

The pre-Wave-C free-text-string error bodies (e.g. `"Invalid observation
type: X"`) are retired in favour of the canonical envelope. Offline-sync
clients now receive a deterministic SCREAMING_SNAKE code.

## In-scope edits beyond the agent allow-list

1. `lib/server/api-errors.ts` — extend `mapApiDomainError` with the four
   new typed errors. Same pattern Wave B used.
2. `__tests__/api/observations.test.ts` — the malformed-timestamp test
   was previously passing by coincidence (it sent an invalid `type`,
   triggering the type-error 400 path before timestamp parsing was
   reached). Updated to use a valid `type`. Added a new test asserting
   the 422 `INVALID_TYPE` typed-code path.
3. `__tests__/api/route-handler-coverage.test.ts` — remove four
   `observations/*` entries from EXEMPT.

## TDD plan

One failing vitest per op was written first under
`lib/domain/observations/__tests__/`, mocking the Prisma client. Each
op was implemented to GREEN, then the routes were rewired onto the
adapters. 18 domain-op cases + 8 route-level cases.

## Out of scope

- Observation analytics (lib/server/analytics.ts, weight-analytics,
  breeding/*) — they read observations but are library callers, not
  in scope.
- `app/api/[farmSlug]/breeding/analyze/route.ts` and
  `app/api/[farmSlug]/performance/route.ts` — different surface, Wave G.
- Migrations or schema changes — zero migration files in this PR.
