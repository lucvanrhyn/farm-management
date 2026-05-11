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
  getCachedCamps,
  getCachedFarmSettings,
  setActiveFarmSlug,
  getFarmEpoch,
  getCachedCampsForEpoch,
  getCachedFarmSettingsForEpoch,
} from '@/lib/offline-store';
import { getCurrentSyncTruth } from '@/lib/sync/queue';
import { refreshCachedData, syncAndRefresh } from '@/lib/sync-manager';
import { Camp } from '@/lib/types';
import { clientLogger } from '@/lib/client-logger';
import { useFarmModeSafe } from '@/lib/farm-mode';

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
  /**
   * Number of queued rows currently in `failed` state across all four sync
   * kinds. Sourced from `getCurrentSyncTruth().failedCount`. Surfaced so the
   * status bar can render a "N failed" pill — closes Codex audit gap C3
   * (stuck-row invisibility).
   */
  failedCount: number;
  /**
   * Timestamp of the most recent FULL-SUCCESS sync cycle. Mirrors
   * `SyncTruth.lastFullSuccessAt` — a partial-failure cycle deliberately does
   * NOT advance this value. This is the truthfulness invariant the C1/C3 bug
   * violated: the UI's "Synced: …" badge is the user's guarantee that
   * everything they queued reached the server.
   */
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
  // Mode is read from FarmModeProvider (mounted above OfflineProvider in
  // `app/[farmSlug]/layout.tsx`). useFarmModeSafe returns a "cattle" default
  // when no provider is present, which keeps unit-test harnesses that mount
  // OfflineProvider in isolation working. Wave D-U3 / Codex audit P2 U3.
  const { mode } = useFarmModeSafe();
  const [isOnline, setIsOnline] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  // pendingCount / failedCount / lastSyncedAt are all derived from a single
  // `getCurrentSyncTruth()` read. The four fields move together — assembling
  // them from independent IDB getters is the exact pattern that produced
  // Codex audit C1 + C3 ("Synced: Just now" lies). Keep them updated through
  // the same `applySyncTruth` writer so divergence is structurally impossible.
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAtState] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [camps, setCamps] = useState<Camp[]>([]);
  const [campsLoaded, setCampsLoaded] = useState(false);
  const [tasks, setTasks] = useState<CachedTask[]>([]);
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null);
  const syncResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the mode the camps in React state were last fetched for. The
  // mode-change effect uses this to skip the initial-mount no-op (the
  // mount-time refresh path already handles the first paint).
  const lastFetchedModeRef = useRef<string | null>(null);
  // Issue #202 — track the slug the per-tenant state above was loaded for.
  // When the pathname's farmSlug changes, reset stale state SYNCHRONOUSLY
  // during render, BEFORE the mount effect's async cache read resolves.
  // Without this, switching from a populated tenant to one with an empty
  // IDB cache leaves the previous tenant's camps/tasks/heroImageUrl in
  // React state because the mount effect's seed path short-circuits
  // `setCamps(cachedCamps)` when `cachedCamps.length === 0`. Same
  // useState-pair pattern as the AnimatedHero fix (#24).
  // See: memory/feedback-react-state-from-props.md.
  const [loadedForSlug, setLoadedForSlug] = useState<string | null>(null);
  if (farmSlug && loadedForSlug !== farmSlug) {
    setCamps([]);
    setTasks([]);
    setHeroImageUrl(null);
    setCampsLoaded(false);
    lastFetchedModeRef.current = null;
    setLoadedForSlug(farmSlug);
  }

  // Re-derives the three SyncTruth-backed fields (pending / failed /
  // lastSyncedAt) from `getCurrentSyncTruth()` in one shot. All consumers
  // that previously called `setPendingCount` / `setLastSyncedAtState`
  // independently now go through this single writer.
  const applySyncTruth = useCallback(async () => {
    const truth = await getCurrentSyncTruth();
    setPendingCount(truth.pendingCount);
    setFailedCount(truth.failedCount);
    setLastSyncedAtState(truth.lastFullSuccessAt);
  }, []);

  // Public name preserved for backward compat — existing call sites
  // (online listener, post-sync refreshes) read "refreshPendingCount" but the
  // implementation now re-derives ALL truth fields atomically.
  const refreshPendingCount = applySyncTruth;

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
      // Otherwise just pull fresh data from server.
      // `species: mode` scopes /api/camps' animal_count to the active species.
      if (pendingCount > 0) {
        await syncAndRefresh({ species: mode });
      } else {
        await refreshCachedData({ species: mode });
      }
      lastFetchedModeRef.current = mode;
      // Do NOT optimistically tick `lastSyncedAt` from a local clock here —
      // that was the C1/C3 root cause. `refreshPendingCount` re-derives all
      // SyncTruth fields from the queue facade, which only advances
      // `lastFullSuccessAt` when the cycle actually finished with zero failures.
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
  }, [pendingCount, syncStatus, mode, refreshPendingCount, refreshHeroImage]);

  const syncNow = useCallback(async () => {
    if (syncStatus === 'syncing') return;
    setSyncStatus('syncing');
    try {
      const { synced, failed } = await syncAndRefresh({ species: mode });
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
      lastFetchedModeRef.current = mode;
      setSyncStatus('idle');
    } catch {
      setSyncStatus('error');
    }
  }, [syncStatus, mode, refreshPendingCount, refreshHeroImage]);

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

    // Seed pendingCount / failedCount / lastSyncedAt from the queue facade.
    // The facade is the single source of truth for these three fields — the
    // legacy per-epoch sync-state getters were deleted in PRD #194 wave 3
    // (#197) because they could disagree with the queue's view of the world
    // (Codex audit C1/C3). See docs/adr/0002-client-side-sync-state.md.
    refreshPendingCount();

    // Paint instantly from cache, then pull fresh IFF the last full sync is
    // older than REFRESH_TTL_MS. A user navigating between logger pages
    // inside the same minute should not trigger four back-to-back
    // /api/camps + /api/animals + /api/farm + /api/camps/status fan-outs.
    // Cache-first is correct here and online-reconnect schedules its own
    // refresh, so users coming back from offline never serve stale data.
    //
    // Freshness check reads `lastFullSuccessAt` via the queue facade — the
    // only source of sync-state truth after PRD #194 (#197).
    Promise.all([
      getCachedCampsForEpoch(epoch),
      getCachedFarmSettingsForEpoch(epoch),
      getCurrentSyncTruth(epoch),
    ]).then(
      ([cachedCamps, cachedSettings, truth]) => {
        // Discard if React unmounted OR if epoch is stale (farm switched mid-flight)
        if (cancelled) return;
        if (cachedCamps === null) return; // stale epoch — another farm's data
        if (cachedCamps.length > 0) setCamps(cachedCamps);
        // M3: heroImageUrl is no longer stored in cache; always fall back to /farm-hero.jpg
        setHeroImageUrl(cachedSettings?.heroImageUrl ?? null);
        setCampsLoaded(true);
        const lastSyncedIso = truth.lastFullSuccessAt;
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

  // Mode-aware camp refresh (Wave D-U3 / Codex audit P2 U3).
  //
  // When the user toggles Cattle↔Sheep via the ModeSwitcher, the camp grid's
  // `animal_count` chips must update to the new species' counts. The mount
  // effect's initial refresh already pulls camps scoped to the current mode
  // (via `refreshData`), so we only need to re-fetch on a SUBSEQUENT change.
  //
  // `lastFetchedModeRef` is seeded by `refreshData` / `syncNow` on every
  // successful refresh. On first commit it is `null` — we seed it to the
  // current mode to avoid a duplicate fan-out (the mount effect's freshness
  // gate will handle the first fetch). On any later mode change, we compare
  // and fire a refresh if they diverge.
  //
  // IDB seeding intentionally is NOT mode-partitioned: `seedCamps` writes
  // whatever the server returned (mode-scoped animal_count for the
  // CURRENT mode). The React state `camps` stays in sync via `refreshData`'s
  // `setCamps(updated)` call. A future visit on a different mode triggers a
  // fresh fetch that overwrites the cache — acceptable for v1.
  useEffect(() => {
    if (!campsLoaded) return;
    if (lastFetchedModeRef.current === null) {
      // Initial mount path: seed the ref to silence the first invocation.
      lastFetchedModeRef.current = mode;
      return;
    }
    if (lastFetchedModeRef.current === mode) return;
    refreshData();
    // refreshData updates lastFetchedModeRef internally on success.
  }, [mode, campsLoaded, refreshData]);

  return (
    <OfflineContext.Provider
      value={{
        isOnline,
        syncStatus,
        pendingCount,
        failedCount,
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
