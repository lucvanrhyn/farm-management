'use client';

import { useEffect, useRef, useState } from 'react';
import { useOffline } from './OfflineProvider';
import FailedSyncDialog from './FailedSyncDialog';
import { OfflineBanner } from './OfflineBanner';
import { SyncBadge } from './SyncBadge';

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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

        {/* Right: last synced + action buttons */}
        <div className="flex items-center gap-3">
          <span style={{ color: 'rgba(210, 180, 140, 0.7)' }}>
            Synced: {formatRelativeTime(lastSyncedAt)}
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
