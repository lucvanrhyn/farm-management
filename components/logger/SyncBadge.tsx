'use client';

/**
 * components/logger/SyncBadge.tsx — Issue #252 / PRD #250 wave 2.
 *
 * A small, drop-in pill that renders the queued-pending count next to any
 * piece of logger chrome. Consumes `useSyncQueueStatus()` directly so it
 * has zero prop surface and can be slotted into any header without the
 * parent threading state.
 *
 * Render rules:
 *   - `pendingCount === 0` → render nothing. The header stays uncluttered
 *     in the steady-state.
 *   - `pendingCount > 0` → orange pill with the count. The pill is purely
 *     informational; the parent (`LoggerStatusBar`) owns the "Upload"
 *     action button so the badge can be reused on screens where manual
 *     upload doesn't make sense.
 *
 * The component is INFORMATIONAL only — it does NOT trigger sync. The
 * "Upload now" affordance lives on the parent so SyncBadge can be slotted
 * into screens (e.g. logger child pages) where the button would be noise.
 */

import { useSyncQueueStatus } from './OfflineProvider';

export interface SyncBadgeProps {
  /**
   * Override the data source — defaults to `useSyncQueueStatus()`. The
   * override exists for tests and for surfaces (e.g. an admin debug page)
   * that already hold a snapshot in scope.
   */
  readonly count?: number;
  /**
   * Optional accessible label override. Default: "N pending sync".
   * Useful for surfaces that distinguish between "your queued obs" and
   * "queued obs across all loggers".
   */
  readonly ariaLabel?: string;
}

export function SyncBadge({ count, ariaLabel }: SyncBadgeProps) {
  const { pendingCount } = useSyncQueueStatus();
  const value = count ?? pendingCount;

  // Steady-state hide: a logger with nothing queued should not see a chip.
  // The badge is a signal, not a permanent fixture.
  if (value <= 0) return null;

  const label = ariaLabel ?? `${value} pending sync`;

  return (
    <span
      data-testid="sync-badge"
      role="status"
      aria-label={label}
      className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
      style={{ backgroundColor: '#B87333' }}
    >
      {value} pending
    </span>
  );
}

export default SyncBadge;
