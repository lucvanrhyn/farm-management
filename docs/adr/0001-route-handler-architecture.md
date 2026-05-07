# Route handler architecture: named transport adapters over a route factory

**Status:** accepted (2026-05-07)

## Context

99 `route.ts` files under `app/api/`. Phase D + G (`lib/server/farm-context.ts`)
consolidated auth + tenant resolution into a single helper, but the handler
shape itself — role gate, fresh-admin re-verify, body parse, try/catch,
typed-error envelope, revalidation — is still hand-rolled per route.

The 2026-05-03 P0.1 incident (stale Prisma client throw → empty 500 → 11 admin
pages broken) was patched only on `/api/animals`; every other route remains
exposed to the same failure class.

## Decision

Adopt a three-layer architecture for HTTP handlers:

1. **Transport adapters** (`lib/server/route/`) — own HTTP shape, auth,
   role checks, body parse, typed-error envelope, revalidation,
   server-timing.
2. **Domain operations** (`lib/domain/<area>/`) — pure operations against
   `{ prisma, ...inputs }`, throw typed domain errors, return plain
   results. Callable from routes, Inngest workers, CSV importers, tests
   without faking a `NextRequest`.
3. **Infrastructure** — `farm-prisma`, `meta-db`, `offline-store`, etc.
   (already exists).

The transport layer exposes four named adapters, not a configurable factory:

- `tenantRead` — `getFarmContext` + handler. GETs.
- `adminWrite` — `getFarmContext` + ADMIN role gate + `verifyFreshAdminRole`
  + body parse + typed-error envelope + revalidate-tag.
- `tenantWrite` — same as `adminWrite` minus the role gate (observations,
  photos, telemetry-like writes any tenant role makes).
- `publicHandler` — typed-error envelope only, for the 14 routes outside
  the proxy matcher (webhooks, telemetry beacon, auth catch-all).

A CI invariant test (modeled on
`__tests__/api/session-consolidation-coverage.test.ts`) enforces that every
non-exempt `route.ts` exports handlers from one of the four adapters,
making "I forgot try/catch on this one route" structurally impossible.

Error envelope: `{ error: CODE, message?: string, details?: Record<string, unknown> }`.
CODE is SCREAMING_SNAKE.

## Why named adapters, not a factory

A `defineRoute({ mode })` factory would be one module with switches; each
route would read like config and the reader (human or agent) would have to
cross-reference the factory's behaviour to know what's enforced. Named
adapters expose the contract at the call site
(`export const POST = adminWrite({...})` reads as a one-line summary of
guarantees). The codebase already prefers named seams: `getFarmContext`
vs. `getFarmContextForSlug` are two named helpers, not one resolver with
a switch.

## Why three layers, not just deepening `route.ts`

Without a domain layer, `handle:` callbacks still hold 30–50 lines of
business logic, so adapter testability is shallow — testing the adapter
doesn't cover the route's behaviour. Domain extraction makes the testable
unit `createCamp(prisma, input)` instead of "the whole route," and lets
Inngest workers / CSV importers reuse the same operation without faking
HTTP. The codebase has already grown half a domain layer organically
(`lib/server/mob-move.ts`, `lib/server/breeding/`,
`lib/server/notification-generator.ts`); this ADR regularises what's
already there.

## Rollout

- **Wave A** — build the four adapters in `lib/server/route/`. Migrate
  every route to use them, but keep `handle:` bodies as-is. Lock the CI
  invariant. The "no route can throw an empty 500" guarantee lands here.
- **Wave B+** — extract domain operations area by area (camps, animals,
  mobs, observations, transactions, tasks). One wave per area. Routes
  shrink to adapter wiring. Each wave is independently shippable.
