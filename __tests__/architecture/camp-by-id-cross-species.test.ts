/**
 * @vitest-environment node
 *
 * Issue #390 (PRD #389, Module 4) — camp-by-id reads must route through
 * `crossSpecies()`, never `scoped()`.
 *
 * Background
 * ──────────
 *   Camps are a CROSS-species concept. A physical camp grazes whatever
 *   species is on it; the row's `species` column records what currently
 *   grazes there, not who may navigate to it. PR #373 (#364) flipped the
 *   camp-map list read from `scoped()` to `crossSpecies("farm-wide-audit")`
 *   for exactly this reason — Trio B (19 camps tagged `species='cattle'`)
 *   rendered "No sheep camps yet" / "0 camps" on sheep FarmMode because
 *   `scoped()` injects `where: { species: mode }`.
 *
 *   The 2026-05-22 Wave 5 (`d4b3918`, ADR-0005 final migration) followed
 *   that same `scoped()` pattern when it migrated three additional camp
 *   surfaces, which over-applied the species filter to:
 *
 *     - `app/[farmSlug]/dashboard/camp/[campId]/page.tsx`     (camp detail)
 *     - `app/[farmSlug]/admin/camps/[campId]/page.tsx`        (admin camp detail)
 *     - `app/[farmSlug]/logger/page.tsx`                      (logger picker)
 *
 *   On a Trio B-shaped tenant the result was: `/dashboard/camp/<id>` and
 *   `/admin/camps/<id>` returned `notFound()` (camp row's `species` ≠
 *   active mode → `findFirst` returned null), and the Sheep Logger camp
 *   picker filtered every cross-species camp out of its `Set<string>` of
 *   allowed IDs. Issue #390 reclassifies the three reads to
 *   `crossSpecies("farm-wide-audit")` — same reason literal PR #373 chose
 *   for camp surfaces, established precedent.
 *
 *   This test is the structural lockdown for these THREE call surfaces. A
 *   contributor who carelessly re-introduces `scoped(...).camp.<op>(` to
 *   any of them fails CI before merge. Other `scoped(...).camp.<op>` call
 *   sites in the codebase (e.g. the per-animal camp lookup in
 *   `dashboard/animal/[animalId]/page.tsx`, which scopes by the *animal's*
 *   species rather than the active FarmMode) are deliberately OUT of
 *   scope here — they're separate tickets with separate semantics. This
 *   test is path-scoped on purpose.
 *
 *   Structural-test conventions inherited from
 *   `__tests__/architecture/species-access-no-direct-prisma.test.ts`:
 *   strip comments + string literals first (so prose mentions don't
 *   false-positive), match a whitespace-tolerant regex (so a multi-line
 *   fluent split can't evade), and emit `file:line offending-call` on
 *   failure so the next contributor sees exactly what to fix.
 *
 * What is and isn't flagged
 * ─────────────────────────
 *   - `scoped(<anything>).camp.findUnique|findFirst|findMany|count|
 *     groupBy|updateMany|deleteMany(` on any of the three audited paths
 *     is flagged.
 *   - `crossSpecies(<anything>).camp.<op>(` is compliant by construction
 *     (different receiver chain).
 *   - Raw `prisma.camp.<op>(` is already governed by ADR-0005's invariant
 *     (`species-access-no-direct-prisma.test.ts`), not this one.
 *   - Comments / string literals mentioning `scoped(...).camp` (e.g. the
 *     issue-#234 JSDoc in `logger/page.tsx` that documents the OLD
 *     facade decision) are stripped before matching, so prose history
 *     doesn't trip the test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");

/**
 * The three page surfaces issue #390 reclassifies, plus the two
 * `/admin/camps` overview call-sites S25 (sp-M1) brought to the same
 * canonical door (the listing page's camp list and CampsTable's
 * rotation-metadata join). Path-scoped on purpose — see file header.
 * Adding a path here is a deliberate edit reviewers can see, never an
 * ambient capability.
 *
 * NOT audited (intentionally species-scoped): the per-species namespace
 * camps pages, e.g. `app/[farmSlug]/sheep/camps/page.tsx` — locked by
 * `__tests__/app/camps-empty-state.test.tsx`.
 */
const AUDITED_PATHS: readonly string[] = [
  "app/[farmSlug]/dashboard/camp/[campId]/page.tsx",
  "app/[farmSlug]/admin/camps/[campId]/page.tsx",
  "app/[farmSlug]/logger/page.tsx",
  "app/[farmSlug]/admin/camps/page.tsx",
  "components/admin/CampsTable.tsx",
];

/** Camp operations that filter rows — every read shape the door exposes. */
const AUDITED_OPS = [
  "findUnique",
  "findFirst",
  "findMany",
  "count",
  "groupBy",
  "updateMany",
  "deleteMany",
];

/**
 * Match `scoped(<args>).camp.<audited-op>(`.
 *
 * - The negative lookbehind `(?<![A-Za-z0-9_$.])` anchors on the literal
 *   identifier `scoped`. Any other helper that happens to end in `scoped`
 *   (e.g. a hypothetical `mySpeciesScoped(`) does not match.
 * - The `\([^)]*\)` between `scoped` and `.camp` permits any argument
 *   list on a single line. A multi-line `scoped(...)` argument list is
 *   rare and would still match the trailing `.camp.<op>(` clause via the
 *   second regex variant below, but the codebase convention is single
 *   line. (If we add a multi-line variant we add it explicitly — the
 *   match should never silently broaden.)
 * - Whitespace is permitted around each `.` and before the `(` so a
 *   multi-line fluent split can't evade by formatting — same hardening
 *   as the ADR-0005 species-access invariant.
 */
const CALL_RE = new RegExp(
  `(?<![A-Za-z0-9_$.])scoped\\s*\\([^)]*\\)\\s*\\.\\s*camp\\s*\\.\\s*(${AUDITED_OPS.join(
    "|",
  )})\\s*\\(`,
  "g",
);

/**
 * Blank out `//` line comments, block comments, and string / template
 * literals (replacing with spaces, preserving newlines so line numbers
 * survive) so the call regex cannot match a token inside prose or a
 * string. Identical strategy to ADR-0005's
 * `species-access-no-direct-prisma.test.ts`.
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

describe("camp-by-id invariant — audited page surfaces use crossSpecies(), never scoped()", () => {
  it("sanity floor — every audited file exists on disk", () => {
    // If one of the three paths is renamed without updating this test
    // the regex would have nothing to scan and the invariant would pass
    // vacuously. Read each file directly and assert it loads.
    for (const rel of AUDITED_PATHS) {
      const abs = join(REPO_ROOT, rel);
      expect(
        () => readFileSync(abs, "utf8"),
        `audited file missing on disk: ${rel}`,
      ).not.toThrow();
    }
  });

  it("no audited camp surface reaches `camp` through scoped()", () => {
    const offenders: string[] = [];
    for (const rel of AUDITED_PATHS) {
      const abs = join(REPO_ROOT, rel);
      const raw = readFileSync(abs, "utf8");
      const scanned = stripCommentsAndStrings(raw);
      CALL_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = CALL_RE.exec(scanned)) !== null) {
        const line = lineOf(scanned, match.index);
        // Reconstruct the offending receiver chain for the error
        // message. Normalise whitespace, strip trailing `(`.
        const offendingText = match[0]
          .replace(/\s+/g, " ")
          .replace(/\($/, "")
          .trim();
        offenders.push(`${rel}:${line}  ${offendingText}(`);
      }
    }
    expect(
      offenders,
      [
        "Audited camp page surfaces must read camps through crossSpecies(), not scoped().",
        "",
        ...offenders.map((o) => `  ${o}`),
        "",
        "Camps are a CROSS-species concept — a physical camp grazes whatever",
        "species is on it. The active FarmMode controls what the user is",
        "looking at, not what infrastructure exists on the farm. Routing a",
        "camp read through scoped() injects `where: { species: mode }` and",
        "hides camps tagged for a different species (PR #373 / #364 fixed",
        "exactly this bug class on the camp map).",
        "",
        "Reclassify to:",
        "",
        "  crossSpecies(prisma, \"farm-wide-audit\").camp.<op>(...)",
        "",
        "`\"farm-wide-audit\"` is the established CrossSpeciesReason literal",
        "for camp surfaces (see PR #373 / #364, `app/[farmSlug]/map/page.tsx`,",
        "`app/api/farm/route.ts`, `app/api/camps/reset/route.ts`).",
        "",
        "See docs/adr/0005-species-access-named-doors.md.",
      ].join("\n"),
    ).toEqual([]);
  });
});
