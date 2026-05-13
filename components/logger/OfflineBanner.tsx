'use client';

/**
 * components/logger/OfflineBanner.tsx — Issue #252 / PRD #250 wave 2.
 *
 * Persistent header banner that signals "you are working offline — your
 * changes are being queued locally and will sync when the connection
 * returns". Renders ONLY while `navigator.onLine === false` (mirrored into
 * `useSyncQueueStatus().isOnline` by `OfflineProvider`).
 *
 * Why a separate banner from the existing `LoggerStatusBar` row:
 *   - The status bar is a single subtle row at the top of the logger; users
 *     scrolling forms below the fold do not see it. The banner is sticky
 *     across the viewport (`position: sticky; top: 0; z-index: 40`) so the
 *     "you are offline" state is permanently visible no matter how far
 *     down a long Reproduction or Death form the user has scrolled.
 *   - The banner ALSO surfaces the queued count when `pendingCount > 0`,
 *     so the user sees both "you are offline" AND "your N changes are
 *     captured and waiting to upload" without having to scroll back up.
 *   - When the user is online but rows are queued (the rare partial state
 *     where a sync attempt is mid-flight), the banner stays hidden and the
 *     status-bar row + SyncBadge are sufficient. The banner is reserved for
 *     the genuinely offline state to avoid noise on flaky-but-recovering
 *     networks.
 *
 * The banner has no actions: clicking does nothing, there is no dismiss.
 * Dismissing an offline state is the responsibility of the network — the
 * UI must not let the user pretend they are online.
 */

import { useSyncQueueStatus } from './OfflineProvider';

export function OfflineBanner() {
  const { isOnline, pendingCount } = useSyncQueueStatus();

  // Steady-state online: render nothing. The banner only exists to surface
  // the offline state. Pending rows while online are surfaced by SyncBadge.
  if (isOnline) return null;

  return (
    <div
      data-testid="offline-banner"
      role="status"
      aria-live="polite"
      aria-label="You are offline. Changes will sync when connection returns."
      className="w-full sticky top-0 z-40 px-4 py-2 flex items-center justify-center gap-2 text-xs font-medium"
      style={{
        // Deep-amber tone consistent with the warning palette used by
        // the failed-sync pill — distinctive against the cream/brown
        // chrome so the banner is impossible to miss.
        backgroundColor: '#7A3E1A',
        color: '#F5F0E8',
        borderBottom: '1px solid rgba(245, 240, 232, 0.18)',
      }}
    >
      <span aria-hidden>⚠</span>
      <span>You&apos;re offline.</span>
      {pendingCount > 0 ? (
        <span style={{ color: 'rgba(245, 240, 232, 0.85)' }}>
          {pendingCount} change{pendingCount === 1 ? '' : 's'} queued — will sync when you reconnect.
        </span>
      ) : (
        <span style={{ color: 'rgba(245, 240, 232, 0.85)' }}>
          Changes will be queued and synced when you reconnect.
        </span>
      )}
    </div>
  );
}

export default OfflineBanner;
