/**
 * lib/client/use-held-navigation.ts — Issue #447.
 *
 * Defers a navigation by a short hold so a just-surfaced toast stays readable,
 * while letting the user skip the wait by pressing Esc. Used by the
 * camp-condition logger submit: an auto-resolved same-day duplicate shows a
 * `role="alert"` toast AND navigates back to the logger root; without the hold
 * the toast flashes for ~300-500 ms before the route transition tears it down.
 *
 * The hold is purely cosmetic — the happy path passes `holdMs = 0` and the
 * navigation fires synchronously, so first-submit flows gain no latency.
 *
 * Lifecycle guarantees:
 *   - Esc while a navigation is pending → flush immediately (skip the wait).
 *   - A second `scheduleHeldNavigation` call replaces any pending navigation.
 *   - Unmount clears any pending timer so we never navigate a torn-down tree.
 */

import { useCallback, useEffect, useRef } from "react";

export interface HeldNavigationApi {
  /**
   * Navigate to `to` after `holdMs`. `holdMs <= 0` navigates synchronously.
   * Pressing Esc (or another schedule call) during the hold flushes early.
   */
  scheduleHeldNavigation: (to: string, holdMs: number) => void;
}

/**
 * @param navigate - The navigation primitive (e.g. a stable `router.push`
 *   wrapper). Kept injectable so the hook is unit-testable without a router.
 */
export function useHeldNavigation(
  navigate: (to: string) => void,
): HeldNavigationApi {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<string | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // `navigate` is expected to be a stable callback (e.g. a `useCallback`
  // wrapper over `router.push`), so `flush` — and the Esc listener that
  // depends on it — re-subscribe at most when the router identity changes.
  const flush = useCallback(() => {
    clearTimer();
    const to = pendingRef.current;
    pendingRef.current = null;
    if (to !== null) navigate(to);
  }, [clearTimer, navigate]);

  const scheduleHeldNavigation = useCallback(
    (to: string, holdMs: number) => {
      clearTimer();
      if (holdMs <= 0) {
        pendingRef.current = null;
        navigate(to);
        return;
      }
      pendingRef.current = to;
      timerRef.current = setTimeout(flush, holdMs);
    },
    [clearTimer, flush, navigate],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pendingRef.current !== null) {
        flush();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      // Drop any pending navigation on unmount — never push a torn-down tree.
      clearTimer();
      pendingRef.current = null;
    };
  }, [flush, clearTimer]);

  return { scheduleHeldNavigation };
}
