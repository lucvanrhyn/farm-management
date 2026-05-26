"use client";

import { useEffect, useState } from "react";

/**
 * SSR-safe ticking-time primitive — issue #422 (parent PRD #419).
 *
 * THE BUG THIS CLOSES
 * -------------------
 * `components/logger/LoggerStatusBar` rendered "Synced: 5m ago" by calling
 * `Date.now()` synchronously inside `formatRelativeTime()` — i.e. during
 * the component's render body. `LoggerStatusBar` is mounted from an RSC
 * (`app/[farmSlug]/logger/page.tsx`), so the SSR pass and the client's
 * first (pre-effect) render both run `Date.now()` but at slightly
 * different wall-clock instants. As soon as the skew crossed a "minute"
 * boundary the server emitted "4m ago" and the client first render
 * emitted "5m ago" → text divergence → React #418 hydration mismatch on
 * every Logger load. Same class of bug as the AdminNav fix in PR #388
 * (commit `f4a3de9`).
 *
 * RELATIONSHIP TO `useClientTime`
 * -------------------------------
 * `lib/hooks/use-client-time.ts` exports `useClientTime(compute, placeholder)`,
 * a ONE-SHOT mount-gated primitive: compute the value once after mount and
 * never tick. That is the right shape for greetings / "today" strings that
 * change at most once per page load.
 *
 * `useNow(intervalMs, seed?)` is the TICKING sibling: re-render every
 * `intervalMs` so derived strings like "X ago" stay fresh. Both hooks share
 * the same hydration-safe shape — the first (server-equivalent) render
 * returns a deterministic placeholder, and the wall clock is only consulted
 * after mount inside an effect.
 *
 * CONTRACT
 * --------
 *   1. First render (SSR and the client's pre-effect render) returns
 *      EXACTLY `seed` (default `0`). `Date.now()` is never invoked during
 *      that render. Server and client first render therefore agree
 *      byte-for-byte regardless of host clock or timezone.
 *   2. After mount, an effect seeds `now = Date.now()` and a `setInterval`
 *      bumps it every `intervalMs`.
 *   3. The interval is cleared on unmount (no leaked timer; no setState
 *      after unmount warning).
 *
 * `useEffect` never runs during `renderToString`, so the server — and the
 * client's very first render — only ever see `seed`.
 *
 * USAGE
 * -----
 * ```tsx
 * function StatusBar({ lastSyncedAt }: { lastSyncedAt: number | null }) {
 *   const now = useNow(60_000); // re-render every minute
 *   return <span>{formatRelativeTime(lastSyncedAt, now)}</span>;
 * }
 * ```
 *
 * The caller is responsible for treating `seed` as "not yet hydrated"
 * (e.g. by gating the derived string on `now > 0`, or by passing the
 * server's known-stable epoch ms as the seed so the placeholder text is
 * still meaningful). For "X ago" copy a `now === 0` check that renders a
 * neutral placeholder ("…") is the simplest hydration-safe shape.
 *
 * @param intervalMs Tick cadence in ms. The internal `setInterval` runs
 *                   at this period; the returned value updates each tick.
 * @param seed       First-render value. Default `0`. Must be deterministic
 *                   (not derived from the wall clock) — otherwise the
 *                   hook re-introduces the very mismatch it exists to
 *                   prevent.
 */
export function useNow(intervalMs: number, seed: number = 0): number {
  const [now, setNow] = useState<number>(seed);

  useEffect(() => {
    // Seed off the wall clock immediately after mount so the very next
    // render shows a fresh value (the placeholder seed is only visible
    // for one paint at most). Mirrors the AdminNav post-mount
    // queueMicrotask pattern in `useHasMounted` — defer the state write
    // off the synchronous effect body to satisfy the repo's
    // no-sync-setState-in-effect lint rule.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setNow(Date.now());
    });

    const id = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs]);

  return now;
}
