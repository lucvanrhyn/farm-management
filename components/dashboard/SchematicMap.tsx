"use client";

/**
 * SchematicMap — public entry point.
 *
 * Phase M: framer-motion previously landed in the dashboard route's
 * initial JS bundle because this file statically imported it at module
 * scope for canvas zoom, per-camp opacity, and AnimatePresence on the
 * zoom-out button. The implementation has moved to ./SchematicMapInner
 * and is loaded here via next/dynamic({ ssr: false }) so framer ships
 * in a separate chunk that only downloads after first paint.
 *
 * ssr: false is required — the inner component uses useRef on the
 * container to compute zoom transforms (client-only measurement), so
 * server-rendering it would either force framer into the server bundle
 * or cause a hydration mismatch.
 *
 * Public API is preserved:
 *   - default export: SchematicMap component
 *   - named export: FilterMode type (type-only, zero runtime cost)
 */

import dynamic from "next/dynamic";

// Re-export the filter-mode type so existing callers don't change.
export type { FilterMode } from "./SchematicMapInner";

// Dynamic-import the framer-using implementation. ssr: false keeps
// framer out of the server bundle and prevents hydration mismatch
// from client-only measurement inside the inner component.
const SchematicMap = dynamic(() => import("./SchematicMapInner"), {
  ssr: false,
  // Placeholder matches the inner container's fill-parent shape so the
  // surrounding dashboard layout doesn't jump while the chunk loads.
  loading: () => (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: "#FFFFFF",
      }}
      aria-hidden
    />
  ),
});

export default SchematicMap;
