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

## Alerts (dashboard alert engine)

These terms pin the single canonical definition of "what counts as an
alert," so the header badge and the `/admin/alerts` page can never again
report different numbers for the same farm (the divergence found
2026-05-17: the header used a bespoke
`grazing_quality === "Poor" || fence_status !== "Intact"` formula while
the engine used eight unrelated sources and never inspected fence status).

### Alert

A `DashboardAlert` — `{ id, severity, icon, message, count, href, species }`.
Severity is `red | amber`. `species` is an `AlertSource` (a `SpeciesId` or
`"farm"` for farm-wide alerts).

### Alert source

One independent contributor of alerts. The eight sources: species-module
alerts, animals-in-withdrawal, camp-conditions, rotation status, veld
summary, feed-on-offer, drought, and camp count (drives stale-inspection).
The **camp-conditions** source alone yields poor-grazing, stale-inspection,
and fence (non-intact) alerts — these three are the only sources derivable
from offline `liveConditions`.

### Alert composition

The single pure function `composeAlerts(inputs)` that derives
`{ red, amber, totalCount }` from a bag of **independently-optional** source
inputs plus required config (`thresholds`, `farmSlug`, `now`). It is the
ONLY place alert severity/messages/counts are decided. An absent source
contributes nothing (it does not emit a zero — "we didn't fetch rotation"
and "rotation is clean" are indistinguishable in the output, by design).
This is the same caller-must-not-re-derive discipline ADR-0002 applies to
`SyncTruth`.

### Partial alert pass

A `composeAlerts` invocation over a subset of sources — the offline header
path, which supplies only the camp-conditions source. Its result is a
**monotone prefix** of the full server pass: every alert id it emits also
appears in the full pass, and `partial.totalCount <= full.totalCount`.
The header badge MUST be a partial pass through `composeAlerts`, never a
re-implemented formula. `getDashboardAlerts(prisma, farmSlug, thresholds,
…)` is the full pass — it fetches all eight sources then calls
`composeAlerts`; its signature is unchanged so its five server callers are
untouched.
