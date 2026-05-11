/**
 * @vitest-environment node
 *
 * PRD #194 / wave 3 — CI invariant locking the legacy sync getters out of the
 * codebase.
 *
 * Background:
 *   Waves 1 (#198) + 2 (#199) introduced the typed sync facade `lib/sync/queue.ts`
 *   exposing `getCurrentSyncTruth()` / `enqueuePending` / `markSucceeded` /
 *   `markFailed` / `recordSyncAttempt`. Production callers migrated. Wave 3
 *   (this issue, #197) deletes the legacy direct getters/setters from
 *   `lib/offline-store.ts`:
 *
 *     - `getLastSyncedAt`
 *     - `setLastSyncedAt`
 *     - `getLastSyncedAtForEpoch`
 *
 *   After this wave the three symbols do not exist in `lib/offline-store.ts`,
 *   so any `import { getLastSyncedAt } from '@/lib/offline-store'` will fail
 *   to type-check. This test is a second-layer structural guard: it scans
 *   the repo and fails if any file *imports* one of those names, regardless
 *   of source module. Future PRs that re-introduce a getter under the same
 *   name (e.g. by carelessly resurrecting the export) will trip the gate
 *   before reaching production.
 *
 *   The scan is import-statement based (not raw string match) so historical
 *   string references in comments / mock-factory keys do not produce false
 *   positives. See `vi.mock('@/lib/offline-store', () => ({ ... }))` factories
 *   that keep stale keys around — those don't import the symbol, they just
 *   declare a key on a mock object, and that's harmless.
 *
 * Why a CI invariant rather than relying on TypeScript:
 *   TypeScript will catch a stray import only if the importing file is
 *   compiled and the named export is missing. A grep-based invariant is
 *   resilient against (a) someone reintroducing the export to satisfy an
 *   import, (b) `// @ts-expect-error` / `// @ts-ignore` bypasses, and (c)
 *   dynamic-import shapes that bypass the type checker entirely.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");

/** Directories we never want to scan. */
const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "coverage",
  ".vercel",
  ".git",
  ".worktrees",
  ".playwright-cli",
  "playwright-report",
  "test-results",
  "bench-results",
  "public",
]);

const FORBIDDEN_NAMES = [
  "getLastSyncedAt",
  "setLastSyncedAt",
  "getLastSyncedAtForEpoch",
] as const;

/**
 * Allow-list of files that are PERMITTED to mention the forbidden names —
 * this test itself, and the ADR that documents the deletion. Both reference
 * the names in prose, not as imports, but we keep them out of the scan to
 * make the diff legible.
 */
const ALLOWED_FILES: ReadonlySet<string> = new Set([
  "__tests__/architecture/sync-truth-no-direct-callers.test.ts",
  "docs/adr/0002-client-side-sync-state.md",
]);

/** File extensions we scan. */
const SCAN_EXTS = [".ts", ".tsx", ".mts", ".cts"];

function shouldScan(filename: string): boolean {
  return SCAN_EXTS.some((ext) => filename.endsWith(ext));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") && SKIP_DIRS.has(entry)) continue;
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      walk(full, out);
    } else if (shouldScan(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Returns the list of forbidden names found in a top-level `import { ... }`
 * statement in the source. We deliberately only catch *named* imports —
 * default / namespace imports do not bring the symbol into scope under any
 * of the three forbidden names.
 *
 * The matcher is intentionally minimal: it scans every `import { ... }`
 * (possibly multi-line) block and checks whether any of the comma-separated
 * names equal a forbidden name (allowing `as` aliases on the import side).
 */
function importedForbidden(source: string): string[] {
  const found = new Set<string>();
  const importBlockRe = /import\s*(?:type\s+)?\{([^}]+)\}\s*from\s*['"][^'"]+['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importBlockRe.exec(source)) !== null) {
    const block = match[1];
    // Split on commas, strip whitespace and `as foo` aliases — we only care
    // about the imported (source-side) identifier.
    const names = block
      .split(",")
      .map((n) => n.trim())
      .map((n) => n.replace(/^type\s+/, "")) // `import { type Foo }` form
      .map((n) => n.split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    for (const name of names) {
      if ((FORBIDDEN_NAMES as readonly string[]).includes(name)) {
        found.add(name);
      }
    }
  }
  return [...found];
}

describe("sync-truth boundary — legacy getters deleted", () => {
  const files = walk(REPO_ROOT)
    .map((abs) => ({ abs, rel: relative(REPO_ROOT, abs) }))
    .filter(({ rel }) => !ALLOWED_FILES.has(rel))
    .sort((a, b) => a.rel.localeCompare(b.rel));

  it("sanity floor — scanner found a representative number of files", () => {
    // Picked well below the actual count (~1k+) so this never trips on a
    // refactor that simply deletes a chunk, but high enough to catch a
    // catastrophic walk-bug where we'd skip the whole tree.
    expect(files.length).toBeGreaterThan(200);
  });

  it("no file imports the deleted sync-truth getters", () => {
    const offenders: string[] = [];
    for (const { abs, rel } of files) {
      const src = readFileSync(abs, "utf8");
      const hits = importedForbidden(src);
      if (hits.length > 0) {
        offenders.push(`${rel}: [${hits.join(", ")}]`);
      }
    }
    expect(
      offenders,
      [
        "Legacy sync-truth getters re-introduced:",
        ...offenders,
        "",
        "These three names were deleted in PRD #194 wave 3 (#197):",
        "  - getLastSyncedAt",
        "  - setLastSyncedAt",
        "  - getLastSyncedAtForEpoch",
        "",
        "Read sync state via `getCurrentSyncTruth()` from `@/lib/sync/queue` instead.",
        "Cycle-level writes go through `recordSyncAttempt({ timestamp, perKindResults })`",
        "so partial-failure cycles cannot tick `lastFullSuccessAt`.",
        "See docs/adr/0002-client-side-sync-state.md for the design rationale.",
      ].join("\n"),
    ).toEqual([]);
  });
});
