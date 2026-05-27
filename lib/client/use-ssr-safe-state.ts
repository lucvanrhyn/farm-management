"use client";

import { useState, useEffect } from "react";

/**
 * useSsrSafeState — eliminate React #418 hydration mismatches caused by
 * client-only `useState` initializers.
 *
 * ## Problem
 * A `useState` lazy initializer that reads browser-only globals
 * (`navigator`, `window`, `localStorage`, `Date.now()`, etc.) produces
 * different values on the server vs. the client's first render pass. React
 * detects the mismatch and throws error #418, then performs a full remount
 * (expensive and visually noisy).
 *
 * ## Solution
 * Render `serverInitial` on the first pass (identical to what the SSR HTML
 * contains). After the component mounts — i.e. after React has finished
 * reconciling server HTML with the first render — a `useEffect` syncs the
 * state to `clientInitial()`. This is safe because effects never run on the
 * server, so the two-phase update is transparent to hydration.
 *
 * ## Usage
 * ```ts
 * // BEFORE (SSR-unsafe — navigator is undefined on server):
 * const [geoFailed, setGeoFailed] = useState<boolean>(() =>
 *   typeof navigator !== "undefined" && !navigator.geolocation
 * );
 *
 * // AFTER (SSR-safe):
 * const geoFailed = useSsrSafeState<boolean>(
 *   false,
 *   () => typeof navigator !== "undefined" && !navigator.geolocation
 * );
 * ```
 *
 * @param serverInitial  Value returned during SSR and on the first client
 *                       render (must match whatever the server would produce —
 *                       typically `false`, `null`, or an empty / zero value).
 * @param clientInitial  Called once after mount to resolve the real
 *                       client-side value. May read any browser API safely.
 * @returns              `serverInitial` on first render; `clientInitial()`
 *                       thereafter.
 */
export function useSsrSafeState<T>(serverInitial: T, clientInitial: () => T): T {
  const [value, setValue] = useState<T>(serverInitial);

  useEffect(() => {
    setValue(clientInitial());
    // clientInitial is intentionally excluded from deps — it is a factory
    // function that should only be called once, after mount, to mirror the
    // semantics of a `useState` lazy initializer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return value;
}
