/**
 * __tests__/perf/home-bundle.test.ts
 *
 * Bundle contract tests for the first-authenticated-page (/[farmSlug]/home).
 *
 * Root cause (Phase M): /home is the landing page after login. Any static
 * `import { motion } from "framer-motion"` in its render tree drags ~40 KB
 * of animation library into the initial JS bundle. P5 shipped the CSS /
 * next/dynamic pattern for /login; these tests lock the same invariant in
 * for the /home tree so the fix doesn't regress.
 *
 * We parse each source file as text (not via the module graph) because
 * that's what webpack's static analyser sees — anything matching these
 * patterns produces a direct import edge to framer-motion in the chunk
 * graph. `next/dynamic()` with a function factory is the only form that
 * breaks the static edge.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");

function read(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

/** Matches `import ... from "framer-motion"` in any quote style. */
const STATIC_FRAMER_IMPORT = /\bfrom\s+["']framer-motion["']/;

/** Matches a `next/dynamic()` call — proves the file uses code-splitting. */
const DYNAMIC_IMPORT_CALL = /\bdynamic\s*\(/;

describe("/home first-load bundle", () => {
  it("app/[farmSlug]/home/page.tsx does not statically import framer-motion", () => {
    const src = read("app/[farmSlug]/home/page.tsx");
    expect(src).not.toMatch(STATIC_FRAMER_IMPORT);
  });

  it("app/[farmSlug]/home/page.tsx splits motion usage via next/dynamic", () => {
    const src = read("app/[farmSlug]/home/page.tsx");
    // Either (a) dynamic() is present (motion extracted + dynamic-imported)
    // or (b) file has no framer reference at all (replaced with CSS).
    const hasDynamic = DYNAMIC_IMPORT_CALL.test(src);
    const hasFramerRef = /framer-motion/.test(src);
    expect(hasDynamic || !hasFramerRef).toBe(true);
  });

  it("components/dashboard/DashboardClient.tsx does not statically import framer-motion", () => {
    const src = read("components/dashboard/DashboardClient.tsx");
    expect(src).not.toMatch(STATIC_FRAMER_IMPORT);
  });

  it("components/dashboard/SchematicMap.tsx does not statically import framer-motion", () => {
    const src = read("components/dashboard/SchematicMap.tsx");
    expect(src).not.toMatch(STATIC_FRAMER_IMPORT);
  });
});
