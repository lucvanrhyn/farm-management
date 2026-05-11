# Client-side sync state: a typed queue facade owns truth

**Status:** accepted (2026-05-11)

## Context

The offline sync indicator in `LoggerStatusBar` has lied to users twice. Codex
audit finding **C1** (2026-05-10): every queued `health_issue` /
`animal_movement` observation 422'd against the server allowlist, every row
landed in `failed`, the pending badge stayed populated — and the "Synced: Just
now" timestamp still ticked. Finding **C3** was the same pattern on the
animal-create path. Both incidents traced to the same root cause: the writer
side of `lastSyncedAt` lived behind a caller-must-remember `tickLastSyncedAt:
boolean` parameter threaded through `refreshCachedData`, and two call sites
forgot to pass `false` on the all-failed path.

The C1 incident is documented in the original wave-A1 fix that this ADR's
sibling test (`__tests__/sync/sync-manager-truth.test.ts`) replaces. Both bugs
were structural — the truth-tick lived in two places (a `setLastSyncedAt` write
inside cache pulls, and an `if (tickLastSyncedAt) setLastSyncedAt(…)` branch
inside `syncAndRefresh`) and the UI consumer (`OfflineProvider`) read
`getLastSyncedAt()` in isolation, with no awareness of whether the displayed
value reflected a full-success cycle or a partial one. Fixing the symptom
required threading another boolean. Fixing the root cause required redrawing
the boundary.

PRD #194 wraps the redraw: PR #198 (wave 1) shipped the facade; PR #199 (wave
2) migrated UI consumers and added a "N failed" pill so stuck rows can no
longer hide; PR #197 (this wave) deletes the legacy getters and locks the
boundary with a CI invariant.

## Decision

Adopt a three-layer architecture for client-side sync state:

1. **`lib/offline-store.ts`** — IndexedDB persistence layer. Owns each
   pending kind's raw rows (`pending_observations`, `pending_animal_creates`,
   `pending_photos`, `pending_cover_readings`) and a generic `metadata` k/v
   store. Exposes per-kind enqueue helpers, per-kind row-status writers, per
   kind pending/failed counters, and a typed `getSyncMetadataValue` /
   `setSyncMetadataValue` pair for the facade to persist cycle-level
   timestamps. **Does not** expose any sync-truth aggregator — the
   pre-existing `getLastSyncedAt` / `setLastSyncedAt` /
   `getLastSyncedAtForEpoch` exports were deleted in wave 3.
2. **`lib/sync/queue.ts`** — typed sync-queue facade. The single module
   allowed to derive `SyncTruth`. Exposes:
   - `enqueuePending(kind, row)` — kind-tagged dispatch over the four
     per-kind enqueue helpers.
   - `markSucceeded(kind, id, _serverPayload?)` /
     `markFailed(kind, id, _reason)` — row-level state transitions.
   - `recordSyncAttempt({ timestamp, perKindResults })` — the **only**
     entry point that can move `lastFullSuccessAt`. Always ticks
     `lastAttemptAt`. Ticks `lastFullSuccessAt` if and only if every
     entry in `perKindResults` reports `failed === 0`.
   - `getCurrentSyncTruth(epoch?)` — single read entry point. Returns
     `{ pendingCount, failedCount, lastAttemptAt, lastFullSuccessAt }`.
3. **UI consumers** (`components/logger/OfflineProvider.tsx`,
   `LoggerStatusBar`, etc.) — consume `SyncTruth` only. The provider
   re-derives all three fields atomically from a single
   `getCurrentSyncTruth()` read in its `applySyncTruth` writer; no other
   code path mutates the three React state slots independently.

`SyncTruth.lastFullSuccessAt` is the field the displayed "Synced: …" badge
mirrors — explicitly **not** `lastAttemptAt`. A partial-failure cycle moves
the latter (so debug tooling can tell "we tried at T") but leaves the former
pinned to the most recent zero-failure cycle (so the user is never told their
queue is clean when it isn't).

## Why a facade, not just discipline

A "remember to pass `false`" pattern caused two production incidents. The same
class of mistake could be re-introduced by any caller that adds a new sync
path without reading the entire `syncAndRefresh` body. Defensive parameters
default to the wrong thing because the *common* call path is the partial-
success one, and that's the path where the value of the parameter actually
matters.

`recordSyncAttempt({ perKindResults })` makes the partial-vs-full distinction
structural: there is no boolean to forget, because the facade derives full-
success from the same per-kind result map the cycle already produces. A caller
that adds a fifth sync kind cannot accidentally tick `lastFullSuccessAt` while
the new kind reports `failed > 0` — the new kind shows up in the map, the
`.every(r => r.failed === 0)` check sees it, and `lastFullSuccessAt` stays
put.

The same principle applies on the read side. `OfflineProvider` previously
assembled the three context fields from independent IndexedDB reads
(`getPendingCount()` + `getLastSyncedAt()` + a derived `failedCount` from a
different path), which let them drift between renders. The wave-2 migration
collapsed all three into one `applySyncTruth` writer that re-derives all of
them from a single `getCurrentSyncTruth()` read, so a stale `pendingCount`
paired with a fresh `lastSyncedAt` is no longer expressible.

## Why a CI invariant test

Discipline + a deleted export is not enough. A future PR could re-add a
getter under the same name (in `offline-store.ts` or anywhere else) and
re-introduce the bug class. The architecture test
`__tests__/architecture/sync-truth-no-direct-callers.test.ts` walks every
`.ts` / `.tsx` file in the repo and fails CI if it finds a top-level named
import of `getLastSyncedAt`, `setLastSyncedAt`, or `getLastSyncedAtForEpoch`.
The scan is import-statement based so historical mentions in comments or
`vi.mock(...)` factory keys do not produce false positives — only an actual
import binding pulls the symbol into scope, and only an actual import is
flagged.

The test mirrors the shape of `__tests__/api/route-handler-coverage.test.ts`
(ADR-0001's CI invariant) so the two architectural guardrails read the same
way.

## Rollout

- **Wave 1 ([PR #198](https://github.com/lucvanrhyn/farm-management/pull/198), 2026-05-11)** —
  introduce `lib/sync/queue.ts` alongside the existing getters. Migrate
  `lib/sync-manager.ts` writers to call `markSucceeded` / `markFailed` /
  `recordSyncAttempt`. UI consumers continue reading
  `getLastSyncedAt()` so the surface area is unchanged.
- **Wave 2 ([PR #199](https://github.com/lucvanrhyn/farm-management/pull/199), 2026-05-11)** —
  migrate `components/logger/OfflineProvider.tsx` to source all three
  context fields from `getCurrentSyncTruth()`. Add `failedCount` to the
  context shape + render a "N failed" pill in `LoggerStatusBar` so stuck
  rows are visible to users.
- **Wave 3 ([PR #197](https://github.com/lucvanrhyn/farm-management/pull/197), 2026-05-11)** —
  delete the three legacy exports from `lib/offline-store.ts`; collapse
  the cache-only `setLastSyncedAt` tick out of `refreshCachedData`; trim
  the obsolete `lastSyncedAt`-specific tests; add the CI invariant +
  this ADR.

All three waves shipped 2026-05-11. The pattern (deepen the boundary, migrate
consumers, delete the old surface, lock the invariant) is the same one ADR-0001
used for the four-adapter route-handler architecture, and is the preferred
template for future architectural waves.
