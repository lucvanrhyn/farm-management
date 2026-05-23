/**
 * @vitest-environment node
 *
 * ADR-0006 — the observation-write invariant, locked structurally.
 *
 * Background
 * ──────────
 *   ADR-0004 §4 declared that `Observation` creation goes through a
 *   single named door (`createObservation`) so the species-stamping
 *   waterfall lives in one place. ADR-0005 made *reads* unforgeable
 *   via `scoped()` / `crossSpecies()`. The 2026-05-21 audit found
 *   three call sites that bypass the door:
 *
 *     - `app/api/animals/[id]/photos/route.ts` — raw
 *       `prisma.observation.create` with hand-set species.
 *     - `lib/domain/tasks/update-task.ts` — raw `tx.observation.create`
 *       inside `prisma.$transaction`, re-implementing the
 *       species-from-animal denorm inline.
 *     - `lib/domain/mobs/move-mob.ts` — TWO raw `tx.observation.create`
 *       (source-camp + dest-camp `mob_movement` rows). NO `species`
 *       field set; every mob movement since the column landed has
 *       produced two NULL-species rows.
 *
 *   ADR-0006 names `createObservation(client, input)` as the only
 *   legal write door (signature widened to accept
 *   `ObservationWriter = PrismaClient | TxClient` so it works both
 *   inline and inside `$transaction`). This test is the structural
 *   lockdown — modelled shape-for-shape on ADR-0005's
 *   `species-access-no-direct-prisma.test.ts` and ADR-0002's
 *   `sync-truth-no-direct-callers.test.ts`.
 *
 * What is and isn't flagged
 * ─────────────────────────
 *   - `prisma.observation.create(` or `<any-tx-name>.observation.create(`
 *     on a tenant code path is flagged.
 *   - `findUnique` / `findFirst` / `findMany` / etc. on the observation
 *     model are governed by ADR-0005's invariant, not this one.
 *   - Calls through `createObservation(client, ...)` do not match the
 *     `<receiver>.observation.create` pattern at all — they are
 *     compliant by construction.
 *   - The match is BINARY: presence of the call, not presence of a
 *     `species:` key. No baseline. No pragma.
 *
 * Structural exemptions (ADR-0006 — no per-file allowlist, no pragma):
 *   - The door module itself: `lib/domain/observations/create-observation.ts`.
 *   - `migrations/`, `prisma/`, `scripts/` (seed/maintenance), `docs/`,
 *     `e2e/`.
 *   - Any test file (`.test.` / `.spec.` / under `__tests__/`).
 *
 * Why strip comments and string literals first
 * ────────────────────────────────────────────
 *   The door module's own JSDoc references the forbidden call shape
 *   when documenting *what it replaces*, and downstream prose in
 *   migrated files may cite the pre-migration pattern. A raw regex
 *   would false-positive on those. We blank out `//` + block comments
 *   and string/template literals (identical strategy to
 *   `species-access-no-direct-prisma.test.ts`) before matching.
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
  // Structural exemptions: by-path-prefix code that is not a tenant
  // write path subject to the observation-write invariant.
  "migrations",
  "prisma",
  "scripts",
  "docs",
  "e2e",
]);

/**
 * Files that are structurally exempt from the invariant. The door
 * module is the seam definition itself, which by construction must
 * touch raw `prisma.observation.create` / `<writer>.observation.create`
 * to forward.
 *
 * This is NOT a per-call allowlist (ADR-0006 forbids that). It is the
 * structural door-module set.
 */
const EXEMPT_FILES: ReadonlySet<string> = new Set([
  "lib/domain/observations/create-observation.ts",
]);

/** File extensions we scan. */
const SCAN_EXTS = [".ts", ".tsx", ".mts", ".cts"];

/**
 * Match `<identifier>.observation.create(`.
 *
 * - Receiver-agnostic on purpose: a raw call may use `prisma.`, `tx.`,
 *   `client.`, or any other binding the caller picks. The invariant is
 *   the *call shape*, not the receiver name.
 * - The negative lookbehind `(?<![A-Za-z0-9_$.])` anchors on a free
 *   identifier (so `foo.observation.create(` matches but
 *   `MyType.observation.create(` inside a type position does too — the
 *   audited surface is `.ts`/`.tsx`, type positions don't compile-call
 *   `.create`, and the comment/string strip pass blanks out any prose).
 * - Whitespace / newlines are permitted around each `.` and before the
 *   `(` so a multi-line fluent split (`tx.observation\n.create(`)
 *   cannot evade by formatting — the same hardening as the species
 *   access regex.
 * - We do NOT match `createObservation(` (the door call) because the
 *   receiver chain `<x>.observation.create` does not appear in
 *   `createObservation(client, input)` source.
 */
const CALL_RE = new RegExp(
  `(?<![A-Za-z0-9_$.])[A-Za-z_$][A-Za-z0-9_$]*\\s*\\.\\s*observation\\s*\\.\\s*create\\s*\\(`,
  "g",
);

function shouldScan(filename: string): boolean {
  return SCAN_EXTS.some((ext) => filename.endsWith(ext));
}

function isTestFile(rel: string): boolean {
  return (
    rel.includes("__tests__/") ||
    rel.includes(".test.") ||
    rel.includes(".spec.")
  );
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
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
 * Blank out `//` line comments, block comments, and string / template
 * literals (replacing with spaces, preserving newlines so line numbers
 * survive) so the call regex cannot match a token inside prose or a
 * string. Identical strategy to the species-access invariant.
 */
function stripCommentsAndStrings(src: string): string {
  const out: string[] = new Array(src.length);
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") {
        out[i] = " ";
        i++;
      }
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      while (i < src.length - 1 && !(src[i] === "*" && src[i + 1] === "/")) {
        out[i] = src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < src.length - 1) {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out[i] = " ";
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") {
          out[i] = " ";
          if (i + 1 < src.length) out[i + 1] = " ";
          i += 2;
        } else {
          out[i] = src[i] === "\n" ? "\n" : " ";
          i++;
        }
      }
      if (i < src.length) {
        out[i] = " ";
        i++;
      }
      continue;
    }
    out[i] = ch;
    i++;
  }
  return out.join("");
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

describe("observation-write invariant — raw <writer>.observation.create is forbidden", () => {
  const files = walk(REPO_ROOT)
    .map((abs) => ({ abs, rel: relative(REPO_ROOT, abs).split("\\").join("/") }))
    .filter(({ rel }) => !isTestFile(rel))
    .filter(({ rel }) => !EXEMPT_FILES.has(rel))
    .sort((a, b) => a.rel.localeCompare(b.rel));

  it("sanity floor — scanner found a representative number of files", () => {
    // Same floor logic as the species-access invariant: well below the
    // actual count (700+ source files) so this never trips on a refactor
    // that deletes a chunk, but high enough to catch a catastrophic
    // walk-bug (broken glob / wrong root) that would make the invariant
    // vacuously pass.
    expect(files.length).toBeGreaterThan(300);
  });

  it("sanity floor — door module itself contains an `observation.create` call", () => {
    // If the file-walk silently skipped the door module (e.g. the path
    // exemption broke), the invariant would pass vacuously. Read the
    // door directly and assert it carries the call shape we are
    // structurally exempting.
    const doorPath = join(
      REPO_ROOT,
      "lib/domain/observations/create-observation.ts",
    );
    const raw = readFileSync(doorPath, "utf8");
    const stripped = stripCommentsAndStrings(raw);
    CALL_RE.lastIndex = 0;
    const match = CALL_RE.exec(stripped);
    expect(
      match,
      "door module must contain at least one observation.create call",
    ).not.toBeNull();
  });

  it("no source file reaches Observation.create without the named door", () => {
    const offenders: string[] = [];
    for (const { abs, rel } of files) {
      const raw = readFileSync(abs, "utf8");
      // Cheap pre-filter: skip files that cannot possibly contain a
      // match. Require only the bare tokens; the regex itself is the
      // authoritative matcher.
      if (!raw.includes("observation") || !raw.includes(".create")) {
        continue;
      }
      const scanned = stripCommentsAndStrings(raw);
      CALL_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = CALL_RE.exec(scanned)) !== null) {
        const line = lineOf(scanned, match.index);
        // Reconstruct the offending receiver chain for the error
        // message. Strip trailing `(` and whitespace.
        const offendingText = match[0]
          .replace(/\s+/g, "")
          .replace(/\($/, "");
        offenders.push(`${rel}:${line}  ${offendingText}(`);
      }
    }
    expect(
      offenders,
      [
        "Raw Observation.create() found outside the named door.",
        "",
        ...offenders.map((o) => `  ${o}`),
        "",
        "`Observation` may be created on a tenant code path ONLY through",
        "the named door:",
        "",
        "  await createObservation(client, { type, camp_id, ... })",
        "",
        "  // client is `ObservationWriter` (PrismaClient | TxClient) — the",
        "  // door works inline AND inside prisma.$transaction. Pass `tx`",
        "  // when you need atomicity with sibling mutations.",
        "",
        "Defined in `lib/domain/observations/create-observation.ts`.",
        "The door enforces the species-stamping waterfall",
        "(animal_id → mob_id → camp species → null) and throws typed",
        "errors on FK misses; a raw `<x>.observation.create({ species: ... })`",
        "re-opens the silent-NULL hole the door exists to close.",
        "",
        "See docs/adr/0006-observation-write-named-door.md.",
      ].join("\n"),
    ).toEqual([]);
  });
});
