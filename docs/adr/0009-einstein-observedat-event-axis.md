# Einstein semantic retrieval: window date queries on the event axis (`observedAt`), not the mutation axis

**Status:** Accepted (2026-06-13) — closes the deferred "clean fork" of #516 (Einstein retrieval hardening). Ships with migration `0028_einstein_chunk_observed_at.sql`.

## Context

Farm Einstein answers natural-language questions over farm data via two retrieval paths (`lib/einstein/retriever.ts`):

- **Structured path** — typed Prisma counts + detail rows. It already windows each entity on its true **event axis**: `Observation.observedAt`, `Task.dueDate`, `Notification.createdAt` (the `observedAt` detail-row grounding shipped in #547).
- **Semantic/vector path** — `vector_distance_cos` over `EinsteinChunk`, with an optional date window.

The semantic path windowed the date range on `EinsteinChunk.sourceUpdatedAt` — the **record-mutation axis** (the source row's `updatedAt`/`editedAt` at embed time, which also drives stale detection). For most rows the mutation date is close to the event date, but they diverge whenever a row is logged or edited away from when the event happened — e.g. an observation back-filled from a paper logbook, where `observedAt` is in March but the row was created in May. A "what happened in the last two weeks?" question then matched the wrong chunks on the semantic path, even though the structured path (which grounds the actual answer) was correct.

This was the long-deferred half of #516. The blocker on record was never the code — it was the **backfill**: `sourceUpdatedAt` is not the event date for existing chunks, so retro-fitting a true event date would mean re-joining every chunk to its source row, per tenant, with a transient window where date-windowed semantic queries could regress.

## Decision

Add a **nullable** `EinsteinChunk.observedAt DateTime?` column carrying the event-axis date, and window the semantic path on `COALESCE(observedAt, sourceUpdatedAt)`. Specifically:

1. **Schema + migration.** `observedAt DateTime?` on `EinsteinChunk` (Prisma) + `migrations/0028_einstein_chunk_observed_at.sql` (`ALTER TABLE … ADD COLUMN "observedAt" DATETIME`, nullable, no default, **no backfill UPDATE**). `EinsteinChunk` is operator-provisioned (excluded from `lib/farm-schema.ts` because of its `F32_BLOB`/`libsql_vector_idx` DDL), but column ALTERs flow through the numbered migration pipeline — precedent: `0014` added `chunkerVersion`/`contentHash` the same way.
2. **Chunker.** `lib/einstein/chunker.ts` resolves the event axis per entity (`resolveEventDate`): observation→`observedAt`, task→`dueDate`, notification→`createdAt`; `null` for camp/animal/task_template/it3_snapshot (no natural event axis). Distinct from `resolveSourceDate` (the mutation axis), which is unchanged.
3. **Ingestion.** `lib/server/inngest/einstein.ts` persists `observedAt` on every chunk upsert (create + update + P2002-recovery update).
4. **Retriever.** The semantic date window becomes `COALESCE(observedAt, sourceUpdatedAt) >= ? / <= ?`, and the returned chunk date is surfaced as `COALESCE(observedAt, sourceUpdatedAt) AS sourceUpdatedAt` so the chunk's date matches the axis it was filtered on. The `RetrievalChunk` contract is unchanged (still one date field). `sourceUpdatedAt` stays in the table for stale detection — this is additive, not a replacement.

### Why COALESCE — the zero-regression transition (no backfill)

`COALESCE(observedAt, sourceUpdatedAt)` dissolves the backfill problem that kept this deferred:

- **Existing chunks** have `observedAt = NULL` → COALESCE falls them back to `sourceUpdatedAt` → **byte-identical to the pre-column behaviour**. No regression window, ever.
- **New and re-embedded chunks** carry a real `observedAt` → event-axis-correct date windows.
- The event axis therefore **fills in naturally** as entities change and re-embed. No re-join backfill, no `chunkerVersion` bump, no full re-embed cost (the chunk *text* and `contentHash` are unchanged by adding metadata, so existing chunks are not forced to re-embed). The improvement is opportunistic and free.

### What we explicitly did NOT do

- **No `chunkerVersion` bump / forced re-embed.** A full re-embed would back-fill `observedAt` for all rows immediately, but at real OpenAI embedding cost across every tenant (the #516 budget caps exist for a reason) and for a *secondary* path — the structured detail rows already ground date-windowed answers correctly (#547). The COALESCE fallback makes the forced re-embed unnecessary.
- **No backfill UPDATE.** Recovering the true event date for old chunks needs a per-entity-type re-join to the source rows; COALESCE makes it unnecessary, and a partial/incorrect backfill would be worse than NULL.
- **No index on `observedAt`.** The semantic query is dominated by the `vector_distance_cos` scan + `ORDER BY distance`; the date predicate is a post-filter on a COALESCE expression a plain column index can't serve. Adding one would be cost without benefit.

## Consequences

- Date-windowed **semantic** retrieval becomes event-axis-correct for all data ingested/changed from this migration forward, converging on full coverage as chunks re-embed, with **zero regression** for chunks predating the column.
- The semantic and structured paths now share one event-axis definition (observation→observedAt, task→dueDate, notification→createdAt), removing the axis mismatch that motivated #516.
- `top-K` (16) and the structured detail cap (25) remain one-line tunables in `lib/einstein/defaults.ts`; this ADR does not change them.
- Future option (not taken now): if a tenant wants immediate full event-axis coverage, bump `CURRENT_CHUNKER_VERSION` to force a re-embed — a deliberate, cost-aware operator action, not the default.
