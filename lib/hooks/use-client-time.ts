"use client";

import { useEffect, useState } from "react";

/**
 * SSR-safe client-time primitive — issue #283 (parent PRD #279).
 *
 * THE BUG THIS CLOSES
 * -------------------
 * Reading the wall clock (`new Date()`, `Date.now()`) during a component's
 * render body is a hydration hazard. The server renders in UTC; the client's
 * first (pre-effect) render runs in the browser's locale/timezone. When the
 * clock straddles a greeting boundary or a calendar-day rollover, the server
 * HTML text differs from the client's first-render text and React throws the
 * recurring #418 hydration mismatch on every dashboard load
 * (`DashboardClient` greeting / today-string / animated counters).
 *
 * #276 (commit 2653be5) only patched `AnimatedNumber` with an ad-hoc
 * `useState(0)` guard. This module generalises that single fix into ONE
 * reusable mount-gated primitive: the first render (server-equivalent) is
 * ALWAYS a caller-supplied stable placeholder; the real, locale-/clock-
 * dependent value is computed only AFTER mount inside an effect. Server
 * render and client first render therefore always agree byte-for-byte,
 * independent of host timezone or wall clock.
 *
 * `useEffect` never runs during `renderToString`, so the server — and the
 * client's very first render — only ever see the placeholder.
 */

/**
 * `true` only after the component has mounted on the client. `false` on the
 * server and on the client's first render — so any branch gated on this is
 * hydration-safe. This is the underlying gate `useClientTime` is built on;
 * exported for callers (e.g. `AnimatedNumber`) that gate a non-time value.
 */
export function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}

/**
 * Returns `placeholder` on the first (server-equivalent) render, then the
 * result of `compute(new Date())` after mount.
 *
 * `compute` is NOT invoked during the first render — it cannot read the wall
 * clock until the client is hydrated, which is exactly what makes the server
 * and client first render agree.
 *
 * @param compute     Pure mapping from "now" to the value to display. Only
 *                     called post-mount.
 * @param placeholder Stable value rendered identically on server & client
 *                     first render. Must not depend on the clock.
 */
export function useClientTime<T>(
  compute: (now: Date) => T,
  placeholder: T,
): T {
  const mounted = useHasMounted();
  return mounted ? compute(new Date()) : placeholder;
}
