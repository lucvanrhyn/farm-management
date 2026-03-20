'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import { getPendingCount, getLastSyncedAt, getCachedCamps } from '@/lib/offline-store';
import { refreshCachedData, syncAndRefresh } from '@/lib/sync-manager';
import { Camp } from '@/lib/types';

type SyncStatus = 'idle' | 'syncing' | 'error';

interface SyncResult {
  synced: number;
  timestamp: number;
}

interface OfflineContextType {
  isOnline: boolean;
  syncStatus: SyncStatus;
  pendingCount: number;
  lastSyncedAt: string | null;
  syncResult: SyncResult | null;
  camps: Camp[];
  syncNow: () => Promise<void>;
  refreshData: () => Promise<void>;
  refreshPendingCount: () => Promise<void>;
  refreshCampsState: () => Promise<void>;
}

const OfflineContext = createContext<OfflineContextType | null>(null);

export function useOffline() {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used within OfflineProvider');
  return ctx;
}

export function OfflineProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAtState] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [camps, setCamps] = useState<Camp[]>([]);
  const syncResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshPendingCount = useCallback(async () => {
    const count = await getPendingCount();
    setPendingCount(count);
  }, []);

  const refreshCampsState = useCallback(async () => {
    const updated = await getCachedCamps();
    setCamps(updated);
  }, []);

  const refreshData = useCallback(async () => {
    if (syncStatus === 'syncing') return;
    setSyncStatus('syncing');
    try {
      // If there are pending changes, sync-and-refresh (handles both sync + cache pull)
      // Otherwise just pull fresh data from server
      if (pendingCount > 0) {
        await syncAndRefresh();
      } else {
        await refreshCachedData();
      }
      const iso = new Date().toISOString();
      setLastSyncedAtState(iso);
      await refreshPendingCount();
      // Reload camps into context after refresh
      const updated = await getCachedCamps();
      setCamps(updated);
      setSyncStatus('idle');
    } catch (err) {
      console.error('refreshData error:', err);
      setSyncStatus('error');
    }
  }, [pendingCount, syncStatus, refreshPendingCount]);

  const syncNow = useCallback(async () => {
    if (syncStatus === 'syncing') return;
    setSyncStatus('syncing');
    try {
      const { synced } = await syncAndRefresh();
      if (synced > 0) {
        setSyncResult({ synced, timestamp: Date.now() });
        if (syncResultTimerRef.current) clearTimeout(syncResultTimerRef.current);
        syncResultTimerRef.current = setTimeout(() => setSyncResult(null), 4000);
      }
      // Reload camps into context after refresh
      const updated = await getCachedCamps();
      setCamps(updated);
      await refreshPendingCount();
      setSyncStatus('idle');
    } catch {
      setSyncStatus('error');
    }
  }, [syncStatus, refreshPendingCount]);

  // Initialize on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsOnline(navigator.onLine);
    refreshPendingCount();
    getLastSyncedAt().then(setLastSyncedAtState);

    // Load camps: paint instantly with cache, always pull fresh in background
    getCachedCamps().then((existing) => {
      if (existing.length > 0) setCamps(existing);
      refreshData();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshPendingCount]);

  // Online/offline listeners
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncNow();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncNow]);

  return (
    <OfflineContext.Provider
      value={{
        isOnline,
        syncStatus,
        pendingCount,
        lastSyncedAt,
        syncResult,
        camps,
        syncNow,
        refreshData,
        refreshPendingCount,
        refreshCampsState,
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
}
