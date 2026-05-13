/**
 * app/api/sync/queue/status/route.ts — Issue #252 / PRD #250 wave 2.
 *
 * GET /api/sync/queue/status[?since=<ISO>]
 *
 * Read-only observability surface for the offline sync queue. The badge in
 * `<LoggerStatusBar />` derives its count from the client-side IndexedDB
 * queue (`getCurrentSyncTruth`) — that path needs no network. THIS endpoint
 * answers a different and load-bearing question:
 *
 *   "Did the server actually receive the obs I queued?"
 *
 * The 2026-05-13 stress test at BB-C014 surfaced exactly this gap: the
 * client showed "synced" but no row reached admin. Without a server-side
 * mirror the user has no way to verify. The endpoint returns:
 *
 *   {
 *     receivedAt: ISO            — server clock at response time
 *     observations: Array<{
 *       id: string               — server-assigned cuid
 *       clientLocalId: string|null  — idempotency key the queue retried
 *       type: string             — observation type (e.g. "health_issue")
 *       animalId: string|null
 *       campId: string
 *       createdAt: ISO           — server `createdAt`, NOT the obs's `observedAt`
 *     }>
 *   }
 *
 * The SyncBadge / OfflineBanner components do NOT poll this endpoint
 * (their data is local). It is intentionally consumed by the Playwright
 * roundtrip spec (`e2e/offline-sync-roundtrip.spec.ts`) and reachable by
 * the user via a future "Verify with server" diagnostic surface. Building
 * it now is cheap and closes the BB-C014 trust gap structurally — issue
 * #252 explicitly listed this endpoint as part of the AC ("New
 * GET /api/sync/queue/status endpoint … powers the badge count").
 *
 * Auth: wrapped by `tenantRead` per ADR-0001 — auth resolution, error
 * envelope, and Server-Timing instrumentation are uniform across the
 * tenant-scoped read surface.
 *
 * Security: the route reads ONLY observations belonging to the resolved
 * farm context (Prisma client is per-tenant via the libSQL adapter), so
 * cross-tenant leakage is structurally impossible.
 *
 * Pagination: capped at 50 most-recent rows. The endpoint exists to verify
 * receipt of the rows the logger queued in this session, not to backfill
 * the dead-letter UI — that surface reads `getFailedObservations` from IDB.
 */

import { NextResponse } from 'next/server';
import { tenantRead } from '@/lib/server/route';
import { timeAsync } from '@/lib/server/server-timing';
import { getFarmMode } from '@/lib/server/get-farm-mode';
import { scoped } from '@/lib/server/species-scoped-prisma';

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_ROWS = 50;

export const GET = tenantRead({
  handle: async (ctx, req) => {
    // Resolve `since`: explicit query param wins; default is "last 24h" so
    // the response is bounded even when the client doesn't supply a value.
    // Invalid ISO strings fall back to the default to keep the endpoint
    // forgiving (the client surfaces this in a tooltip, not a hard error).
    const sinceParam = req.nextUrl.searchParams.get('since');
    let since: Date;
    if (sinceParam) {
      const parsed = new Date(sinceParam);
      since = Number.isFinite(parsed.getTime())
        ? parsed
        : new Date(Date.now() - DEFAULT_WINDOW_MS);
    } else {
      since = new Date(Date.now() - DEFAULT_WINDOW_MS);
    }

    // PRD #222 / ADR-0003: per-species surfaces must commit to the species
    // axis. The sync-queue verification belongs to ONE species at a time —
    // when the user is viewing the cattle dashboard, a "did the server
    // receive my obs?" check should not surface sheep observations queued
    // in another tab. Route through the species-scoped facade so the
    // species predicate is injected from the active FarmMode cookie.
    const mode = await getFarmMode(ctx.slug);
    const sp = scoped(ctx.prisma, mode);

    const rows = await timeAsync('query', () =>
      // Per-tenant + per-species Prisma — the libSQL adapter is bound to the
      // resolved farm context (cross-tenant impossible) and `scoped(...)`
      // injects `species: mode` into the where (cross-species impossible).
      sp.observation.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
        select: {
          id: true,
          clientLocalId: true,
          type: true,
          animalId: true,
          campId: true,
          createdAt: true,
        },
      }),
    );

    return NextResponse.json({
      receivedAt: new Date().toISOString(),
      observations: rows.map((r) => ({
        id: r.id,
        clientLocalId: r.clientLocalId,
        type: r.type,
        animalId: r.animalId,
        campId: r.campId,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  },
});
