/**
 * @vitest-environment node
 *
 * ADR-0005 — the species-access invariant, locked structurally.
 *
 * Background
 * ──────────
 *   PRD #222 / issue #224 introduced `scoped(prisma, mode)`
 *   (`lib/server/species-scoped-prisma.ts`) — a real seam where the
 *   species predicate is a required positional argument, so a per-species
 *   surface that forgets it is a *compile* error rather than a silent
 *   all-species leak. ADR-0005 added the typed sibling
 *   `crossSpecies(prisma, reason)` for queries that INTENTIONALLY span
 *   every species, and the multi-wave rollout migrated every call site
 *   onto one of the two doors.
 *
 *   The four species-bearing models — `Animal`, `Camp`, `Mob`,
 *   `Observation` — may now be reached on a tenant code path ONLY via a
 *   named door. A raw `prisma.<model>.<op>` that filters by `where`
 *   (findMany / findFirst / count / groupBy / updateMany / deleteMany)
 *   is the cross-species-leak bug class: the call typechecks, returns
 *   rows, and the rows silently include every species.
 *
 *   This test replaces the content-inspecting `scripts/audit-species-
 *   where.ts` + `.audit-species-where-baseline.json` +
 *   `audit-allow-species-where:` pragma machinery (deleted in ADR-0005's
 *   final wave, #353). It is modelled on
 *   `__tests__/architecture/sync-truth-no-direct-callers.test.ts`
 *   (ADR-0002's invariant) — same file-walk, same sanity floor, same
 *   offender-list-in-failure-message shape. The check is BINARY:
 *   presence of a *named door*, not presence of a *where key*. There is
 *   no baseline to grandfather.
 *
 * What is and isn't flagged
 * ─────────────────────────
 *   - `prisma.{animal,camp,mob,observation}.{findMany,findFirst,count,
 *     groupBy,updateMany,deleteMany}(` is flagged.
 *   - `findUnique` / `findUniqueOrThrow` / `findFirstOrThrow` are NOT
 *     flagged: these are strict by-primary-key lookups that cannot leak
 *     across species (a row either exists or it doesn't), and the
 *     Camp/Mob/Observation door builders deliberately have no
 *     `findUnique`. This exclusion is a documented ADR-0005
 *     clarification, not a silent test hack — see
 *     `docs/adr/0005-species-access-named-doors.md`.
 *   - Calls routed through `scoped(prisma, mode).<model>.<op>(...)` or
 *     `crossSpecies(prisma, reason).<model>.<op>(...)` do not match the
 *     `prisma.<model>` receiver regex (the receiver is the builder, not
 *     `prisma`), so they are compliant by construction.
 *
 * Why strip comments and string literals first
 * ────────────────────────────────────────────
 *   Several non-exempt source files carry illustrative
 *   `prisma.animal.findMany(...)` in JSDoc / inline prose (e.g.
 *   `lib/farm-prisma.ts`, `lib/api/dto.ts`, `app/api/animals/route.ts`,
 *   `lib/server/has-multiple-species.ts`,
 *   `lib/domain/animals/list-animals.ts`). A raw regex would
 *   false-positive on those. We blank out `//` + block comments and
 *   string/template literals (the proven strategy the deleted
 *   `audit-species-where.ts` used) before matching.
 *
 * Structural exemptions (ADR-0005 Decision pt 3 — no per-file allowlist,
 * no pragma):
 *   - The two-door module itself: `lib/server/species-scoped-prisma.ts`.
 *   - `lib/server/animal-search.ts` — the documented deep-module access
 *     seam for the per-species animal-listing axis. It enforces
 *     `species: mode` itself (composedWhere) but cannot route through
 *     `scoped()` because that builder force-injects `status:
 *     ACTIVE_STATUS`, which would silently drop the deceased rows SARS
 *     requires (issue #255). Exempted as a structural door-module by
 *     path; recorded in the ADR (NOT a silent test hack).
 *   - `migrations/`, `prisma/`, `scripts/` (seed/maintenance), `docs/`.
 *   - Any test file (`.test.` / `.spec.` / under `__tests__/`).
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
  // read path subject to the species axis.
  "migrations",
  "prisma",
  "scripts",
  "docs",
  "e2e",
]);

/**
 * Files that are structurally exempt from the invariant. Each is the
 * source module of a named access door (or a documented deep-module
 * seam that enforces the species axis itself but cannot route through
 * `scoped()` — see `lib/server/animal-search.ts` rationale in the file
 * header and `docs/adr/0005-species-access-named-doors.md`).
 *
 * This is NOT a per-call allowlist (ADR-0005 forbids that). It is the
 * structural door-module set — the seam definitions themselves, which
 * by construction must touch raw `prisma.<model>` to forward.
 */
const EXEMPT_FILES: ReadonlySet<string> = new Set([
  "lib/server/species-scoped-prisma.ts",
  "lib/server/animal-search.ts",
]);

/** File extensions we scan. */
const SCAN_EXTS = [".ts", ".tsx", ".mts", ".cts"];

/** Per-species models that carry the species axis. */
const SPECIES_MODELS = ["animal", "camp", "mob", "observation"];

/**
 * Operations that filter by `where` and can therefore silently span
 * species. `findUnique` / `findUniqueOrThrow` / `findFirstOrThrow` are
 * deliberately EXCLUDED — strict by-PK lookups cannot leak across
 * species (documented ADR-0005 clarification).
 */
const AUDITED_OPS = [
  "findMany",
  "findFirst",
  "count",
  "groupBy",
  "updateMany",
  "deleteMany",
];

/**
 * Match `prisma.<species-model>.<audited-op>(`.
 *
 * - The negative lookbehind `(?<![A-Za-z0-9_$.])` anchors on the literal
 *   identifier `prisma`. `scoped(prisma, m).animal.findMany(` and
 *   `crossSpecies(prisma, r).animal.findMany(` do NOT match: the
 *   receiver of `.animal` there is the builder return value, and the
 *   source has no `prisma.animal.` substring at all (it is
 *   `).animal.findMany`). Door calls are compliant by construction.
 * - `findUnique` / `findUniqueOrThrow` / `findFirstOrThrow` are NOT in
 *   `AUDITED_OPS`, and the trailing `\s*\(` requires the op token to be
 *   immediately followed by `(`. `prisma.animal.findFirstOrThrow(`
 *   therefore cannot match `findFirst` (the next char after `findFirst`
 *   is `O`, not whitespace-or-`(`); `prisma.animal.findUnique(` matches
 *   no enumerated op. By-PK strict lookups stay out of the invariant by
 *   design (ADR-0005 clarification).
 */
//
// Whitespace / newlines are permitted around each `.` and before the
// `(` so a multi-line fluent split —
//
//   await prisma.animal
//     .findMany({ ... })
//
// cannot evade the invariant by formatting. (The deleted single-line
// `audit-species-where.ts` regex had exactly this blind spot.)
const CALL_RE = new RegExp(
  `(?<![A-Za-z0-9_$.])prisma\\s*\\.\\s*(${SPECIES_MODELS.join(
    "|",
  )})\\s*\\.\\s*(${AUDITED_OPS.join("|")})\\s*\\(`,
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
 * string. Identical strategy to the (now-deleted) `audit-species-where`
 * + `audit-findmany-no-select` scripts.
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

describe("species-access invariant — raw prisma on species models is forbidden", () => {
  const files = walk(REPO_ROOT)
    .map((abs) => ({ abs, rel: relative(REPO_ROOT, abs).split("\\").join("/") }))
    .filter(({ rel }) => !isTestFile(rel))
    .filter(({ rel }) => !EXEMPT_FILES.has(rel))
    .sort((a, b) => a.rel.localeCompare(b.rel));

  it("sanity floor — scanner found a representative number of files", () => {
    // Picked well below the actual count (700+ source files) so this
    // never trips on a refactor that deletes a chunk, but high enough to
    // catch a catastrophic walk-bug (broken glob / wrong root) that
    // would make the invariant vacuously pass.
    expect(files.length).toBeGreaterThan(300);
  });

  it("no source file reaches a species model without a named door", () => {
    const offenders: string[] = [];
    for (const { abs, rel } of files) {
      const raw = readFileSync(abs, "utf8");
      // Cheap pre-filter: skip files that cannot possibly contain a
      // match. It MUST be no stricter than CALL_RE itself — a substring
      // pre-filter like `prisma.${m}.` would wrongly skip a multi-line
      // fluent split (`prisma.animal\n.findMany(`), the exact blind spot
      // we hardened the regex to close. Require only the bare tokens.
      if (
        !raw.includes("prisma") ||
        !SPECIES_MODELS.some((m) => raw.includes(m))
      ) {
        continue;
      }
      const scanned = stripCommentsAndStrings(raw);
      CALL_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = CALL_RE.exec(scanned)) !== null) {
        const line = lineOf(scanned, match.index);
        offenders.push(`${rel}:${line}  prisma.${match[1]}.${match[2]}(`);
      }
    }
    expect(
      offenders,
      [
        "Raw prisma access to a species-bearing model found.",
        "",
        ...offenders.map((o) => `  ${o}`),
        "",
        "The four species models (Animal, Camp, Mob, Observation) may be",
        "reached on a tenant code path ONLY through a named door:",
        "",
        "  - scoped(prisma, mode).<model>.<op>(...)        // per-species",
        "  - crossSpecies(prisma, reason).<model>.<op>(...) // deliberate",
        "                                                   // cross-species",
        "",
        "Both are defined in `lib/server/species-scoped-prisma.ts`.",
        "A per-species surface that forgets the species predicate silently",
        "leaks every species' rows; a cross-species roll-up scoped to one",
        "mode silently drops the others. Pick the door that states intent.",
        "",
        "by-PK strict lookups (findUnique / findUniqueOrThrow /",
        "findFirstOrThrow) are intentionally outside this invariant —",
        "they cannot leak across species. See",
        "docs/adr/0005-species-access-named-doors.md.",
      ].join("\n"),
    ).toEqual([]);
  });
});
