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
 *
 * Stability note: the Esc listener and unmount cleanup are registered ONCE
 * (empty/stable deps). `navigate` is read through a ref that an effect keeps
 * current, so a churning `navigate` identity (e.g. a router object that is a
 * fresh reference each render) never re-subscribes the listener — and never
 * runs the cleanup that would wipe an in-flight pending navigation mid-hold.
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
 * @param navigate - The navigation primitive (e.g. a `router.push` wrapper).
 *   Read through a ref, so it need not be referentially stable.
 */
export function useHeldNavigation(
  navigate: (to: string) => void,
): HeldNavigationApi {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<string | null>(null);
  const navigateRef = useRef(navigate);

  // Keep the latest `navigate` reachable from the (once-registered) listener
  // and the deferred timer callback. Updated in an effect — never during
  // render — so it satisfies react-hooks/refs.
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Stable (deps: only the stable `clearTimer`) so the effects below register
  // exactly once for the component's lifetime.
  const flush = useCallback(() => {
    clearTimer();
    const to = pendingRef.current;
    pendingRef.current = null;
    if (to !== null) navigateRef.current(to);
  }, [clearTimer]);

  const scheduleHeldNavigation = useCallback(
    (to: string, holdMs: number) => {
      clearTimer();
      if (holdMs <= 0) {
        pendingRef.current = null;
        navigateRef.current(to);
        return;
      }
      pendingRef.current = to;
      timerRef.current = setTimeout(flush, holdMs);
    },
    [clearTimer, flush],
  );

  // Esc skips the hold → navigate immediately. Registered once (flush stable).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pendingRef.current !== null) flush();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flush]);

  // Drop any pending navigation on UNMOUNT only — never on a render-triggered
  // effect re-run (this effect's deps are stable, so its cleanup fires once).
  useEffect(
    () => () => {
      clearTimer();
      pendingRef.current = null;
    },
    [clearTimer],
  );

  return { scheduleHeldNavigation };
}
