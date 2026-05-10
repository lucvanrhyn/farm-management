"use client";

/**
 * Client-side hook that turns next-auth's `useSession()` into an actionable
 * "is the session about to die or already dead?" view.
 *
 * Why this exists (P1.6 — production-triage 2026-05-03):
 * --------------------------------------------------------
 * `useSession()` reports `status` ∈ {loading, authenticated, unauthenticated}
 * and a `data` payload that includes an ISO `expires` string. Two failure
 * modes hit the user with no UI feedback:
 *
 *   1. **Idle expiry.** The user leaves the tab open past `session.expires`.
 *      next-auth only re-checks on its own poll cadence (default off in this
 *      app — `refetchOnWindowFocus={false}`), so the next click 401s with a
 *      blank console-only error.
 *   2. **Active expiry.** The token actually expires while the user is
 *      mid-form (visual-audit catch: ~2 min observed in headless preview).
 *
 * This hook gives the UI a single timer-driven boolean for each case so the
 * banner can render proactively (case 1) and react to next-auth's own
 * detection (case 2).
 *
 * Contract:
 *   - `expiresAt`: parsed Date from `session.expires`, or null while
 *     loading/unauthenticated.
 *   - `timeRemainingMs`: live ms until expiry; recomputes every 1 s while
 *     authenticated; null otherwise.
 *   - `isExpiringSoon`: true when `0 < timeRemainingMs <= warnAheadMs`.
 *   - `isExpired`: true when wall-clock has crossed `expiresAt` OR when
 *     next-auth flips status to "unauthenticated" *after* a previous
 *     authenticated session was observed (so a fresh page load that lands on
 *     "unauthenticated" doesn't spuriously trigger the banner).
 *
 * The 1 s tick is cheap (single setInterval per app shell) and makes the
 * banner feel reactive without a render storm.
 */

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

export interface UseSessionExpiryOptions {
  /** ms before expiry to flag as "expiring soon". Default 60_000 (1 min). */
  warnAheadMs?: number;
}

export interface UseSessionExpiryResult {
  status: "loading" | "authenticated" | "unauthenticated";
  expiresAt: Date | null;
  timeRemainingMs: number | null;
  isExpired: boolean;
  isExpiringSoon: boolean;
}

const DEFAULT_WARN_AHEAD_MS = 60_000;

export function useSessionExpiry(
  options: UseSessionExpiryOptions = {},
): UseSessionExpiryResult {
  const warnAheadMs = options.warnAheadMs ?? DEFAULT_WARN_AHEAD_MS;
  const { data, status } = useSession();

  // Track whether we ever held an authenticated session, so a transition
  // authenticated → unauthenticated counts as "expired" (real signal) but a
  // fresh load that lands directly on unauthenticated does NOT (the user
  // simply isn't logged in — show login form, not a banner).
  //
  // Uses the React-blessed useState-pair pattern (memory:
  // feedback-react-state-from-props.md): observe a prop/derived value
  // during render, compare to a tracked snapshot, and call setState
  // during render when they diverge. React reschedules the same render
  // synchronously — no extra commit, no "setState in effect" lint hit.
  const [hasBeenAuthenticated, setHasBeenAuthenticated] = useState(false);
  if (status === "authenticated" && !hasBeenAuthenticated) {
    setHasBeenAuthenticated(true);
  }

  // `now` is owned by state so React renders are deterministic and the
  // hook stays pure (no `Date.now()` during render). The setInterval below
  // bumps it each second while authenticated; tests under fake timers
  // observe identical behaviour.
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (status !== "authenticated") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status]);

  return useMemo<UseSessionExpiryResult>(() => {
    if (status === "loading") {
      return {
        status,
        expiresAt: null,
        timeRemainingMs: null,
        isExpired: false,
        isExpiringSoon: false,
      };
    }

    if (status === "unauthenticated") {
      return {
        status,
        expiresAt: null,
        timeRemainingMs: null,
        // Only treat as "expired" if we previously saw an authenticated
        // session — otherwise this is just a logged-out tab.
        isExpired: hasBeenAuthenticated,
        isExpiringSoon: false,
      };
    }

    // status === "authenticated"
    const expiresIso = (data as { expires?: string } | null)?.expires;
    if (!expiresIso) {
      return {
        status,
        expiresAt: null,
        timeRemainingMs: null,
        isExpired: false,
        isExpiringSoon: false,
      };
    }
    const expiresAt = new Date(expiresIso);
    const timeRemainingMs = expiresAt.getTime() - now;
    const isExpired = timeRemainingMs <= 0;
    const isExpiringSoon = !isExpired && timeRemainingMs <= warnAheadMs;

    return {
      status,
      expiresAt,
      timeRemainingMs,
      isExpired,
      isExpiringSoon,
    };
  }, [status, data, warnAheadMs, now, hasBeenAuthenticated]);
}
