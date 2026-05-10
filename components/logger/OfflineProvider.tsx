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
import { usePathname } from 'next/navigation';
import { openDB } from 'idb';
import {
  getPendingCount,
  getLastSyncedAt,
  getCachedCamps,
  getCachedFarmSettings,
  setActiveFarmSlug,
  getFarmEpoch,
  getCachedCampsForEpoch,
  getLastSyncedAtForEpoch,
  getCachedFarmSettingsForEpoch,
} from '@/lib/offline-store';
import { refreshCachedData, syncAndRefresh } from '@/lib/sync-manager';
import { Camp } from '@/lib/types';
import { clientLogger } from '@/lib/client-logger';

type SyncStatus = 'idle' | 'syncing' | 'error';

// Skip the on-mount /api/{camps,animals,farm,camps/status} fan-out when the
// cached data was refreshed within the last minute. Covers the common pattern
// of navigating between logger pages in quick succession — previously every
// mount burned a fresh 4-request fan-out, saturating function concurrency on
// large farms and making the logger feel sluggish on re-entry. The `online`
// listener still always triggers a fresh sync on reconnect, so users coming
// back from offline never serve stale data.
const REFRESH_TTL_MS = 60_000;

interface SyncResult {
  synced: number;
  failed: number;
  timestamp: number;
}

// Minimal Task shape for the logger view — full type lives server-side
export interface CachedTask {
  id: string;
  title: string;
  priority: string;
  status: string;
  dueDate: string;
  assignedTo: string;
  campId?: string | null;
  description?: string | null;
}

interface OfflineContextType {
  isOnline: boolean;
  syncStatus: SyncStatus;
  pendingCount: number;
  lastSyncedAt: string | null;
  syncResult: SyncResult | null;
  camps: Camp[];
  campsLoaded: boolean;
  tasks: CachedTask[];
  heroImageUrl: string | null;
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

// Read tasks from IndexedDB if the tasks store exists (added in DB v3).
// Returns an empty array if the store is not present yet so the UI degrades gracefully.
async function getCachedTasks(farmSlug: string): Promise<CachedTask[]> {
  try {
    const db = await openDB(`farmtrack-${farmSlug}`);
    if (!db.objectStoreNames.contains('tasks')) return [];
    return db.getAll('tasks') as Promise<CachedTask[]>;
  } catch {
    return [];
  }
}

export function OfflineProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const farmSlug = pathname.split('/')[1] || '';
  const [isOnline, setIsOnline] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAtState] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [camps, setCamps] = useState<Camp[]>([]);
  const [campsLoaded, setCampsLoaded] = useState(false);
  const [tasks, setTasks] = useState<CachedTask[]>([]);
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null);
  const syncResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshPendingCount = useCallback(async () => {
    const count = await getPendingCount();
    setPendingCount(count);
  }, []);

  const refreshCampsState = useCallback(async () => {
    const updated = await getCachedCamps();
    setCamps(updated);
  }, []);

  // M3: heroImageUrl is no longer stored per-tenant in the IDB cache.
  // The background is always /farm-hero.jpg — a single shared asset.
  // refreshHeroImage is retained as a no-op placeholder so call sites
  // in refreshData/syncNow compile without changes.
  const refreshHeroImage = useCallback(async () => {
    const settings = await getCachedFarmSettings();
    // heroImageUrl will always be undefined from the cache layer (M3 stripped it);
    // the null here tells consumers to use their own '/farm-hero.jpg' fallback.
    setHeroImageUrl(settings?.heroImageUrl ?? null);
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
      // Reload camps + hero image into context after refresh
      const updated = await getCachedCamps();
      setCamps(updated);
      await refreshHeroImage();
      setSyncStatus('idle');
    } catch (err) {
      clientLogger.error('refreshData error', { err });
      setSyncStatus('error');
    }
  }, [pendingCount, syncStatus, refreshPendingCount, refreshHeroImage]);

  const syncNow = useCallback(async () => {
    if (syncStatus === 'syncing') return;
    setSyncStatus('syncing');
    try {
      const { synced, failed } = await syncAndRefresh();
      // Surface the toast whenever a sync cycle produced ANY visible outcome —
      // a success, a failure, or a partial mix. Previously we only toasted on
      // synced > 0, so a wave of 422s left users with a green tick and zero
      // signal that anything had gone wrong.
      if (synced > 0 || failed > 0) {
        setSyncResult({ synced, failed, timestamp: Date.now() });
        if (syncResultTimerRef.current) clearTimeout(syncResultTimerRef.current);
        syncResultTimerRef.current = setTimeout(() => setSyncResult(null), 4000);
      }
      // Reload camps + hero image into context after refresh
      const updated = await getCachedCamps();
      setCamps(updated);
      await refreshHeroImage();
      await refreshPendingCount();
      setSyncStatus('idle');
    } catch {
      setSyncStatus('error');
    }
  }, [syncStatus, refreshPendingCount, refreshHeroImage]);

  // Initialize on farm switch — set farm slug for IndexedDB isolation BEFORE any DB calls.
  // The `cancelled` flag discards async results that resolve after a subsequent farm switch,
  // preventing farm A data from briefly appearing on a farm B screen.
  //
  // M4 — farmEpoch: capture the epoch synchronously immediately after setActiveFarmSlug so
  // any IDB read that resolves AFTER a subsequent farm switch can detect staleness and
  // discard the result. The epoch check is a second-layer guard alongside `cancelled` —
  // the cancelled flag handles React StrictMode double-mount, epoch handles the
  // genuinely concurrent "two different farms" case.
  useEffect(() => {
    if (!farmSlug) return;
    setActiveFarmSlug(farmSlug); // synchronous — must be first
    const epoch = getFarmEpoch(); // capture immediately after slug set

    let cancelled = false;

    setIsOnline(navigator.onLine);

    refreshPendingCount();

    // Paint instantly from cache, then pull fresh IFF the last full sync is
    // older than REFRESH_TTL_MS. A user navigating between logger pages
    // inside the same minute should not trigger four back-to-back
    // /api/camps + /api/animals + /api/farm + /api/camps/status fan-outs.
    // Cache-first is correct here and online-reconnect schedules its own
    // refresh, so users coming back from offline never serve stale data.
    Promise.all([
      getCachedCampsForEpoch(epoch),
      getCachedFarmSettingsForEpoch(epoch),
      getLastSyncedAtForEpoch(epoch),
    ]).then(
      ([cachedCamps, cachedSettings, lastSyncedIso]) => {
        // Discard if React unmounted OR if epoch is stale (farm switched mid-flight)
        if (cancelled) return;
        if (cachedCamps === null) return; // stale epoch — another farm's data
        if (cachedCamps.length > 0) setCamps(cachedCamps);
        // M3: heroImageUrl is no longer stored in cache; always fall back to /farm-hero.jpg
        setHeroImageUrl(cachedSettings?.heroImageUrl ?? null);
        setCampsLoaded(true);
        setLastSyncedAtState(lastSyncedIso);
        const lastSyncedMs = lastSyncedIso ? Date.parse(lastSyncedIso) : 0;
        const staleMs = Date.now() - lastSyncedMs;
        if (Number.isNaN(lastSyncedMs) || staleMs > REFRESH_TTL_MS) {
          refreshData();
        }
      },
    );

    // Load tasks from IndexedDB if available (tasks store added in DB v3)
    getCachedTasks(farmSlug).then((cachedTasks) => {
      if (!cancelled) setTasks(cachedTasks);
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmSlug, refreshPendingCount]);

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
        campsLoaded,
        tasks,
        heroImageUrl,
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
