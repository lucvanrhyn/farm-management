"use client";

import { useEffect } from "react";

/**
 * Registers the Serwist service worker at the root layout level so that
 * the SW activates on any page visit — not just /logger.
 *
 * This must be a "use client" component because app/layout.tsx is a
 * server component (it calls getServerSession) and cannot use useEffect.
 *
 * Scoped globally so Dicky doesn't need to visit /logger first for
 * the app shell to be precached.
 */
export function SWRegistrar() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          console.log("[SW] Registered, scope:", reg.scope);
        })
        .catch((err) => {
          console.error("[SW] Registration failed:", err);
        });
    }
  }, []);

  return null;
}
