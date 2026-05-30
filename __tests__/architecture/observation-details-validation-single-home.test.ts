/**
 * @vitest-environment node
 *
 * ADR-0007 (#513) — the per-observation-type `details` validation invariant,
 * locked structurally.
 *
 * Background
 * ──────────
 *   ADR-0007 replaced four hand-rolled, scattered validators (the standalone
 *   `lib/server/validators/{weighing,death,reproductive-state}.ts` modules plus
 *   an inline camp_condition guard in the write door) with ONE schema registry:
 *   `lib/domain/observations/details-schemas.ts`. Each typed observation's
 *   `details` contract — its Zod schema, its `coerceDetails` parse, its typed
 *   error class, its `validate*` entry point — now lives in that single module,
 *   consulted by the write door (`createObservation` / `updateObservation`) via
 *   `validateObservationDetails`.
 *
 *   This test is the structural lockdown — modelled shape-for-shape on
 *   ADR-0006's `observation-write-no-direct-callers.test.ts`. It makes "added a
 *   type-specific `details` validator in the wrong place" a CI error rather than
 *   a convention, so the four-validators-in-three-places sprawl ADR-0007
 *   collapsed cannot silently regrow.
 *
 * What is and isn't flagged
 * ─────────────────────────
 *   - The DEFINITION of a per-type details validator is flagged: declaring a
 *     `validateDeathObservation` / `validateReproductiveState` /
 *     `validateWeighingObservation` / `validateCampConditionComplete` function,
 *     re-declaring the shared `coerceDetails` parse helper, or declaring one of
 *     the per-type typed error classes (`class WeightOutOfRangeError extends
 *     Error`, `DeathMultiCauseError`, …) anywhere outside the registry module.
 *   - REFERENCES are NOT flagged: importing those names, an `instanceof` check
 *     in `mapApiDomainError`, or a back-compat `export { … }` re-export from the
 *     write door. The invariant is about where the validation LOGIC is defined,
 *     not who may consult it.
 *   - The match is on a DEFINITION token (`class <Name> extends`, `function
 *     <name>`), after comments + string/template literals are blanked out (so
 *     prose citing the old shape never false-positives) — the identical strip
 *     strategy ADR-0006's test uses.
 *
 * Structural exemptions (ADR-0007 — the single-home module + its test):
 *   - The registry module itself: `lib/domain/observations/details-schemas.ts`.
 *   - Any test file (`.test.` / `.spec.` / under `__tests__/`).
 *   - `migrations/`, `prisma/`, `scripts/`, `docs/`, `e2e/`.
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
  "migrations",
  "prisma",
  "scripts",
  "docs",
  "e2e",
]);

/**
 * The single-home module. By construction it DEFINES every per-type validator
 * + error class, so it is the one structural exemption.
 */
const REGISTRY_MODULE = "lib/domain/observations/details-schemas.ts";

/** File extensions we scan. */
const SCAN_EXTS = [".ts", ".tsx", ".mts", ".cts"];

/**
 * Definition-shape matchers. Each targets a DECLARATION (not a reference):
 *
 *   - The shared `coerceDetails` parse helper the four validators each
 *     duplicated — the canonical signal ADR-0007 names. A second `function
 *     coerceDetails` anywhere is the sprawl regrowing.
 *   - The per-type `validate*` entry points.
 *   - The per-type typed error CLASS declarations (`class <Name> extends`).
 *
 * Comments + strings are blanked first, so a JSDoc mention or a string literal
 * naming one of these never matches.
 */
const DEFINITION_MATCHERS: ReadonlyArray<{ label: string; re: RegExp }> = [
  {
    label: "duplicate `coerceDetails` details-parse helper",
    re: /(?<![A-Za-z0-9_$.])function\s+coerceDetails\s*\(/g,
  },
  {
    label: "per-type `validate…Observation` / `validate…State` definition",
    re: /(?<![A-Za-z0-9_$.])function\s+validate(?:WeighingObservation|DeathObservation|ReproductiveState|CampConditionComplete)\s*\(/g,
  },
  {
    label: "per-type details typed-error class declaration",
    re: /(?<![A-Za-z0-9_$.])class\s+(?:WeightOutOfRangeError|DeathMultiCauseError|DeathDisposalRequiredError|ReproMultiStateError|ReproRequiredError|ReproFieldRequiredError|CampConditionFieldRequiredError)\s+extends\b/g,
  },
];

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
 * Blank out `//` line comments, block comments, and string / template literals
 * (replacing with spaces, preserving newlines so line numbers survive) so a
 * definition matcher cannot fire on a token inside prose or a string. Identical
 * strategy to ADR-0006's observation-write invariant.
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

describe("observation-details invariant — per-type validation lives only in the registry", () => {
  const files = walk(REPO_ROOT)
    .map((abs) => ({ abs, rel: relative(REPO_ROOT, abs).split("\\").join("/") }))
    .filter(({ rel }) => !isTestFile(rel))
    .filter(({ rel }) => rel !== REGISTRY_MODULE)
    .sort((a, b) => a.rel.localeCompare(b.rel));

  it("sanity floor — scanner found a representative number of files", () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it("sanity floor — the registry module itself DEFINES the validators it exempts", () => {
    // If the file-walk silently skipped the registry (e.g. the exemption
    // broke), the invariant would pass vacuously. Read the registry directly
    // and assert it carries each definition shape we structurally exempt.
    const registryPath = join(REPO_ROOT, REGISTRY_MODULE);
    const stripped = stripCommentsAndStrings(readFileSync(registryPath, "utf8"));
    for (const { label, re } of DEFINITION_MATCHERS) {
      re.lastIndex = 0;
      expect(
        re.test(stripped),
        `registry module must define: ${label}`,
      ).toBe(true);
    }
  });

  it("no source file defines a per-type details validator outside the registry", () => {
    const offenders: string[] = [];
    for (const { abs, rel } of files) {
      const raw = readFileSync(abs, "utf8");
      // Cheap pre-filter: only files that mention one of the tokens at all.
      if (
        !raw.includes("coerceDetails") &&
        !raw.includes("validateWeighingObservation") &&
        !raw.includes("validateDeathObservation") &&
        !raw.includes("validateReproductiveState") &&
        !raw.includes("validateCampConditionComplete") &&
        !raw.includes("OutOfRangeError") &&
        !raw.includes("CauseError") &&
        !raw.includes("StateError") &&
        !raw.includes("RequiredError")
      ) {
        continue;
      }
      const scanned = stripCommentsAndStrings(raw);
      for (const { label, re } of DEFINITION_MATCHERS) {
        re.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = re.exec(scanned)) !== null) {
          const line = lineOf(scanned, match.index);
          offenders.push(`${rel}:${line}  ${label}: ${match[0].trim()}`);
        }
      }
    }
    expect(
      offenders,
      [
        "Per-type observation `details` validation found OUTSIDE the registry.",
        "",
        ...offenders.map((o) => `  ${o}`),
        "",
        "Every typed observation's `details` contract — its schema, its parse",
        "helper, its `validate*` entry point, and its typed error class — lives",
        "in ONE module:",
        "",
        "  lib/domain/observations/details-schemas.ts",
        "",
        "consulted by the write door via `validateObservationDetails(type,",
        "details, { speciesMax })`. Add a new typed observation by registering a",
        "schema THERE — never by re-cloning `coerceDetails` + a validator + an",
        "error class in a route handler or a `lib/server/validators/*` module.",
        "",
        "See docs/adr/0007-observation-details-zod-registry.md.",
      ].join("\n"),
    ).toEqual([]);
  });
});
