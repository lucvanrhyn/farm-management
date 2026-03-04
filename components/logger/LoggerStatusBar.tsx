'use client';

import { useOffline } from './OfflineProvider';

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'Nooit';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Sopas';
  if (minutes < 60) return `${minutes}m gelede`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}u gelede`;
  return `${Math.floor(hours / 24)}d gelede`;
}

export function LoggerStatusBar() {
  const { isOnline, syncStatus, pendingCount, lastSyncedAt, syncResult, syncNow, refreshData } =
    useOffline();

  const statusIcon = !isOnline ? '🔴' : syncStatus === 'syncing' ? '🟡' : '🟢';
  const statusText = !isOnline ? 'Offline' : syncStatus === 'syncing' ? 'Oplaai...' : 'Aanlyn';

  return (
    <>
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
          {pendingCount > 0 && (
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
              style={{ backgroundColor: '#B87333' }}
            >
              {pendingCount} uitstaande
            </span>
          )}
        </div>

        {/* Right: last synced + action buttons */}
        <div className="flex items-center gap-3">
          <span style={{ color: 'rgba(210, 180, 140, 0.7)' }}>
            {formatRelativeTime(lastSyncedAt)}
          </span>
          {isOnline && pendingCount > 0 && (
            <button
              onClick={syncNow}
              className="underline text-[11px] font-medium"
              style={{ color: '#B87333' }}
            >
              Laai op
            </button>
          )}
          <button
            onClick={refreshData}
            className="underline text-[11px]"
            style={{ color: '#D2B48C' }}
          >
            Herlaai data
          </button>
        </div>
      </div>

      {/* Sync success toast */}
      {syncResult && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 text-sm font-medium px-5 py-3 rounded-2xl shadow-xl"
          style={{ backgroundColor: '#B87333', color: '#F5F0E8' }}
        >
          ✓ {syncResult.synced} waarneming{syncResult.synced !== 1 ? 's' : ''} gesink
        </div>
      )}
    </>
  );
}
