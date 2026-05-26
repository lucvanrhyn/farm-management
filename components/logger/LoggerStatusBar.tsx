'use client';

import { useEffect, useRef, useState } from 'react';
import { useOffline } from './OfflineProvider';
import FailedSyncDialog from './FailedSyncDialog';
import { OfflineBanner } from './OfflineBanner';
import { SyncBadge } from './SyncBadge';
import {
  deriveSyncStatusFromCounts,
  type SyncStatusDescriptor,
} from '@/lib/sync/deriveSyncStatus';
import { useNow } from '@/lib/hooks/use-now';

/**
 * Issue #422 — relative-time formatter is now PURE: it takes the current
 * wall-clock epoch as an explicit `nowMs` parameter rather than reading
 * `Date.now()` itself. This is what makes the render hydration-safe — the
 * caller (`LoggerStatusBar`) feeds it the SSR-deterministic `useNow()`
 * seed (`0`) on the first render and the live tick after mount.
 *
 * When `nowMs <= 0` we treat the hook as not-yet-hydrated and render a
 * neutral placeholder ("…") so the server and the client's first render
 * agree byte-for-byte. The real relative-time string appears on the very
 * next paint (the `useNow` post-mount microtask flips `nowMs` to a real
 * `Date.now()` value).
 */
function formatRelativeTime(epochMs: number | null, nowMs: number): string {
  if (epochMs === null) return 'Never';
  // Pre-hydration sentinel. `useNow` seeds with `0` so this branch fires
  // on SSR and the client's very first render — both produce the same
  // placeholder, eliminating the #418 hydration mismatch.
  if (nowMs <= 0) return '…';
  const diff = nowMs - epochMs;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Issue #395 — descriptor → copy map. Renders the right-side status text
 * based on the deriver output. Lives outside the component so the test
 * suite can exercise it directly without a render.
 *
 * "Synced: …" appears ONLY when `kind === 'fresh'` — the bug this issue
 * closes was that the right-hand text always read "Synced" regardless of
 * pending or failed rows in the offline queue.
 *
 * Issue #422 — `nowMs` is now an explicit argument (default `Date.now()`)
 * so the caller can thread a hydration-safe `useNow()` value through.
 * The default keeps the pre-existing direct callers in the test suite
 * working unchanged (those tests mock `Date.now()`).
 */
export function describeSyncStatus(
  descriptor: SyncStatusDescriptor,
  nowMs: number = Date.now(),
): string {
  const { kind, counts, lastSuccessAt } = descriptor;
  switch (kind) {
    case 'fresh':
      return `Synced: ${formatRelativeTime(lastSuccessAt, nowMs)}`;
    case 'syncing':
      return `${counts.pending} pending`;
    case 'failed':
      return `${counts.failed} failed`;
    case 'partial':
      return `${counts.pending} pending · ${counts.failed} failed`;
    case 'stale':
      return `Stale: ${formatRelativeTime(lastSuccessAt, nowMs)}`;
    case 'offline':
      return 'Offline';
  }
}

// Issue #252 — how long a per-item reconnect toast stays on screen before
// being evicted. Matches the existing aggregate-syncResult toast (4s) so the
// two banners feel coherent during a partial-failure cycle.
const ITEM_TOAST_TTL_MS = 4000;

interface ItemToast {
  itemKey: string;
  label: string;
  expiresAt: number;
}

export function LoggerStatusBar() {
  const {
    isOnline,
    syncStatus,
    pendingCount,
    failedCount,
    lastSyncedAt,
    syncResult,
    recentlySyncedItems,
    syncNow,
  } = useOffline();

  // Issue #209 — the failed-row dead-letter dialog. Open state lives here
  // (not in OfflineProvider) because nothing else needs to read it; this is
  // a pure local UI affordance gated on `failedCount > 0`.
  const [dialogOpen, setDialogOpen] = useState(false);

  // Issue #252 — per-item toast state. The OfflineProvider's
  // `recentlySyncedItems` is the source of truth (de-duped + bounded);
  // this component only converts new entries into a transient toast list.
  // We track which itemKeys we've already shown so a re-render that
  // produces the same list doesn't re-toast.
  const [itemToasts, setItemToasts] = useState<ItemToast[]>([]);
  const seenItemKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const fresh = recentlySyncedItems.filter(
      (item) => !seenItemKeysRef.current.has(item.itemKey),
    );
    if (fresh.length === 0) return;
    const now = Date.now();
    const additions: ItemToast[] = fresh.map((item) => {
      seenItemKeysRef.current.add(item.itemKey);
      return {
        itemKey: item.itemKey,
        label: `${item.label} synced`,
        expiresAt: now + ITEM_TOAST_TTL_MS,
      };
    });
    setItemToasts((prev) => [...prev, ...additions]);
  }, [recentlySyncedItems]);

  // Sweep expired toasts every 500ms. A self-scheduling timer rather than
  // per-toast `setTimeout`s keeps the React state writes serial and avoids
  // the classic "toast disappears mid-animation because two timers fired
  // out of order" race.
  useEffect(() => {
    if (itemToasts.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setItemToasts((prev) => prev.filter((t) => t.expiresAt > now));
    }, 500);
    return () => clearInterval(interval);
  }, [itemToasts.length]);

  const statusIcon = !isOnline ? '🔴' : syncStatus === 'syncing' ? '🟡' : '🟢';
  const statusText = !isOnline ? 'Offline' : syncStatus === 'syncing' ? 'Uploading...' : 'Online';

  // Issue #422 — hydration-safe wall-clock for the "X ago" relative-time
  // string. Seeds `0` on the first render (SSR and the client's pre-effect
  // render), then ticks every 30s after mount so the "Synced: 5m ago" copy
  // stays fresh without a console-visible React #418 mismatch. The
  // descriptor → copy mapper treats `0` as "not yet hydrated" and renders
  // a neutral placeholder; the real clock value lands one paint later.
  const nowMs = useNow(30_000);

  // Issue #395 — single derivation point for the right-side copy. Reads the
  // PRD #194 SyncTruth (`lastSyncedAt` is `lastFullSuccessAt` in ISO form),
  // the queue counts, and connectivity. The component renders `copy` and
  // does not concatenate strings or inspect counts itself — that is what
  // produced the "Synced while 12 rows are queued" bug this issue closes.
  const lastSuccessEpochMs = lastSyncedAt ? Date.parse(lastSyncedAt) : null;
  const descriptor = deriveSyncStatusFromCounts(
    pendingCount,
    failedCount,
    Number.isNaN(lastSuccessEpochMs) ? null : lastSuccessEpochMs,
    isOnline,
  );
  const copy = describeSyncStatus(descriptor, nowMs);

  return (
    <>
      {/* Issue #252 — sticky offline banner. Renders ONLY while offline,
          regardless of where the user has scrolled. Above the status-bar
          row so the page chrome reads top-down: "you're offline" → "the
          status row" → "the rest of the logger". */}
      <OfflineBanner />
      <div
        className="px-4 py-1.5 flex items-center justify-between text-xs"
        style={{
          backgroundColor: 'rgba(26, 13, 5, 0.55)',
          borderTop: '1px solid rgba(92, 61, 46, 0.35)',
        }}
      >
        {/* Left: status + pending badge */}
        <div className="flex items-center gap-2">
          <span>{statusIcon}</span>
          <span style={{ color: '#D2B48C' }}>{statusText}</span>
          {/* Issue #252 — extracted to <SyncBadge /> so the same pill can
              be slotted into the offline banner / admin debug surface
              without copying the markup. Renders nothing when count === 0. */}
          <SyncBadge />
          {/* PRD #194 wave 2 — surface stuck rows. Closes Codex audit gap C3:
              previously a row that hit a 422 vanished from the pending count
              into a `failed` IDB state with no UI affordance to retry. The
              red pill is the user's signal to open the offline log.

              Issue #209 — the pill is now a button that opens the dead-letter
              dialog. The dialog renders each failed row with metadata + per-row
              retry; the retry preserves `clientLocalId` so the server upsert
              from #206 / #207 collapses any "client thought POST failed but
              server got it" race to a single canonical row. */}
          {failedCount > 0 && (
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
              style={{ backgroundColor: '#B33A3A' }}
              aria-label={`${failedCount} failed rows pending retry`}
            >
              Failed: {failedCount}
            </button>
          )}
        </div>

        {/* Right: descriptor-driven status copy + action buttons.
            Issue #395 — copy is derived from `descriptor.kind`; no inline
            string concat or count inspection here. "Synced: …" appears
            only when `kind === 'fresh'` (queue empty AND lastSuccessAt
            within `STALE_THRESHOLD_MS`). */}
        <div className="flex items-center gap-3">
          <span
            data-testid="logger-status-copy"
            data-status-kind={descriptor.kind}
            style={{ color: 'rgba(210, 180, 140, 0.7)' }}
          >
            {copy}
          </span>
          {isOnline && pendingCount > 0 && (
            <button
              onClick={syncNow}
              className="underline text-[11px] font-medium"
              style={{ color: '#B87333' }}
            >
              Upload
            </button>
          )}
        </div>
      </div>

      {/* Sync result toasts. Success and failure render as siblings so a
          partial-success cycle (some 200s + some 422s) shows BOTH — the
          user sees the count that landed and the count that needs a retry. */}
      {syncResult && syncResult.synced > 0 && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 text-sm font-medium px-5 py-3 rounded-2xl shadow-xl"
          style={{ backgroundColor: '#B87333', color: '#F5F0E8' }}
        >
          ✓ {syncResult.synced} observation{syncResult.synced !== 1 ? 's' : ''} synced
        </div>
      )}
      {syncResult && syncResult.failed > 0 && (
        <div
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 text-sm font-medium px-5 py-3 rounded-2xl shadow-xl"
          style={{ backgroundColor: '#B33A3A', color: '#F5F0E8' }}
          role="alert"
        >
          ✗ {syncResult.failed} observation{syncResult.failed !== 1 ? 's' : ''} failed to sync — open the offline log to retry
        </div>
      )}

      {/* Issue #252 — per-item replay toasts. Stacked top-right so the
          aggregate success/failure toasts (bottom-center) and the
          per-item cascade do not visually overlap during a partial-failure
          cycle. The user sees both: "12 observations synced" at the bottom,
          one labelled toast per row at the top. */}
      {itemToasts.length > 0 && (
        <div
          data-testid="item-toast-stack"
          className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-xs"
        >
          {itemToasts.map((toast) => (
            <div
              key={toast.itemKey}
              data-testid={`item-toast-${toast.itemKey}`}
              role="status"
              className="text-xs font-medium px-4 py-2 rounded-xl shadow-lg"
              style={{
                backgroundColor: '#3A6B3F',
                color: '#F5F0E8',
                borderLeft: '3px solid #5FBF6A',
              }}
            >
              ✓ {toast.label}
            </div>
          ))}
        </div>
      )}

      <FailedSyncDialog isOpen={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
