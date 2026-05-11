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
