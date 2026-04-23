'use client';

import Image from 'next/image';
import { useParams } from 'next/navigation';
import { OfflineProvider, useOffline } from '@/components/logger/OfflineProvider';
import { useEffect, useRef } from 'react';

// Hero image lives inside OfflineProvider so it can be pulled from the
// IndexedDB cache — no duplicate /api/farm fetch on every logger mount.
// Previously this layout fired its own /api/farm in parallel with the one
// OfflineProvider triggers via refreshCachedData; that duplicate is gone.
function LoggerHero() {
  const { heroImageUrl } = useOffline();
  const src = heroImageUrl ?? '/farm-hero.jpg';
  return (
    <div className="fixed inset-0 z-0 overflow-hidden">
      <Image
        src={src}
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover scale-105"
        style={{ filter: 'blur(5px)' }}
      />
      <div
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(26, 13, 5, 0.45)' }}
        suppressHydrationWarning
      />
    </div>
  );
}

function CampWarmup({ farmSlug }: { farmSlug: string }) {
  // P2 perf de-dupe (2026-04-23): previously this component fired its own
  // `GET /api/camps` in parallel with the one OfflineProvider's
  // refreshCachedData triggers. On a cold visit to /logger the two
  // requests raced (measured 2535ms + 3125ms on Trio B). The fix is to
  // read camps from the same OfflineProvider context that drives the
  // rest of the logger — a single authoritative fetch per cold visit.
  const { camps, campsLoaded } = useOffline();
  const warmedUp = useRef(false);
  useEffect(() => {
    // Pre-fetch camp pages into the SW "pages" cache so they load instantly
    // offline. Root-cause-fix for a previous fan-out that fired N parallel
    // full-HTML fetches on every layout mount:
    //   1. Guard with sessionStorage so it runs once per tab, not per nav.
    //   2. Skip on saveData / slow connections and when offline.
    //   3. Walk sequentially inside requestIdleCallback so the real navigation
    //      never competes with the warm-up queue.
    if (warmedUp.current) return;
    // Wait for the context's initial cache-read to settle. `campsLoaded` is
    // a one-shot signal — false until the first IDB read resolves, then
    // permanently true.
    if (!campsLoaded) return;
    if (camps.length === 0) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    const sessionKey = `farmtrack:loggerWarmed:${farmSlug}`;
    try {
      if (sessionStorage.getItem(sessionKey) === "1") {
        warmedUp.current = true;
        return;
      }
    } catch { /* sessionStorage may be unavailable */ }

    const conn = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (conn?.saveData) return;
    if (conn?.effectiveType && /(^|-)2g$/.test(conn.effectiveType)) return;

    warmedUp.current = true;

    let cancelled = false;
    const schedule = (cb: () => void) => {
      const ric = (window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }).requestIdleCallback;
      if (ric) ric(cb, { timeout: 2000 });
      else setTimeout(cb, 0);
    };

    // Snapshot the camps list so a later context update (e.g. a background
    // refreshCachedData merging in new camp data) doesn't restart the walk.
    const campsSnapshot = [...camps];
    let i = 0;
    const warmNext = () => {
      if (cancelled || i >= campsSnapshot.length) {
        try { sessionStorage.setItem(sessionKey, "1"); } catch { /* ignore */ }
        return;
      }
      const camp = campsSnapshot[i++];
      fetch(`/${farmSlug}/logger/${encodeURIComponent(camp.camp_id)}`, {
        credentials: "same-origin",
      })
        .catch(() => {})
        .finally(() => { if (!cancelled) schedule(warmNext); });
    };
    schedule(warmNext);

    return () => { cancelled = true; };
  }, [farmSlug, campsLoaded, camps]);
  return null;
}

export default function LoggerLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const farmSlug = params.farmSlug as string;

  return (
    <OfflineProvider>
      <LoggerHero />
      <CampWarmup farmSlug={farmSlug} />
      <div className="relative z-10">{children}</div>
    </OfflineProvider>
  );
}
