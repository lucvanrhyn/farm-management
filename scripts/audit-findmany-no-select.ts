#!/usr/bin/env tsx
/**
 * audit-findmany-no-select
 * ────────────────────────
 * Static check that every `prisma.<model>.findMany(...)` in the repo either
 *   1. passes an explicit `select:` so only requested columns are projected,
 *   2. passes an explicit `omit:` so the projection is the inverse of a
 *      named blacklist, OR
 *   3. is preceded by an `// audit-allow-findmany-no-select:` comment that
 *      documents a deliberate full-column read (e.g. an admin export that
 *      genuinely needs every field), OR
 *   4. is listed in the `.audit-findmany-no-select-baseline.json` file
 *      (known legacy offenders pending migration).
 *
 * Why this exists
 * ───────────────
 * PRD #128 (2026-05-06). The basson `Animal.species` incident: column was
 * declared in `prisma/schema.prisma` but never written into a migration file.
 * Every unprojected `prisma.animal.findMany()` SELECTs all columns from the
 * underlying SQLite table — when the column is missing, the query crashes
 * with `SqliteError: no such column: Animal.species` and every admin route
 * that does an unprojected findMany 500s.
 *
 * This audit is the **structural** prevention. The Prisma column-parity
 * check (#131) catches the column-actually-missing condition at runtime;
 * this script forces every `findMany` to commit to a column list at write-
 * time, so a future schema-vs-DB drift is bounded to the queries that
 * explicitly ask for the drifted column. Defense in depth.
 *
 * Note that this audit is **complementary, not redundant**, with
 * `audit-findmany-no-take`:
 *   - `audit-findmany-no-take` enforces row-count bounds (don't materialise
 *     unbounded result sets — perf regression class).
 *   - `audit-findmany-no-select` enforces column-set bounds (don't
 *     materialise every column — schema-drift crash class).
 * A `findMany` can be compliant with one and not the other; both audits
 * must pass independently.
 *
 * Baseline key format
 * ───────────────────
 * Each baseline entry is `path::modelName::occurrenceIndex`, identical to
 * `audit-findmany-no-take.ts`. Stable under pure line-drift.
 *
 * The analyser (`auditSource`) is exported for unit tests; the CLI portion
 * below only runs when the file is invoked directly.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface Offender {
  path: string;
  line: number;
  snippet: string;
  modelName: string;
  occurrenceIndex: number;
}

const FINDMANY_RE = /prisma\.(\w+)\.findMany\s*\(/g;

/**
 * Replace every `//` line comment and `/* … *\/` block comment in `src` with
 * spaces of equal length. Preserves line structure (and therefore the
 * character-index → line-number mapping used elsewhere) while guaranteeing
 * that regex scans can't match tokens that only appear inside a comment.
 *
 * String literals are respected so `"// not a comment"` doesn't get mangled.
 */
function stripComments(src: string): string {
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
      out[i] = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") {
          out[i] = src[i];
          if (i + 1 < src.length) out[i + 1] = src[i + 1];
          i += 2;
        } else {
          out[i] = src[i];
          i++;
        }
      }
      if (i < src.length) {
        out[i] = src[i];
        i++;
      }
      continue;
    }
    out[i] = ch;
    i++;
  }
  return out.join("");
}

/**
 * Return the balanced-paren argument body starting at the `(` index. Returns
 * an empty string if the call is `findMany()` with no args.
 */
function argBody(src: string, open: number): string {
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") i += 2;
        else i++;
      }
      i++;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
    i++;
  }
  return "";
}

/**
 * Given the argument body (contents of the `( ... )`), inspect whether this
 * findMany is compliant — i.e. it carries a top-level `select:` or `omit:`.
 *
 * The check is intentionally loose on the value side (we don't validate the
 * column list itself) but strict on the boundary: `select:` or `omit:` must
 * appear at the top of the args object, not nested inside a `where:` or
 * `metadata:` predicate. A leading boundary character (`{`, `,`, or
 * whitespace at the start of the arg) anchors the match — see the regression
 * test for nested-select strings.
 */
function isCompliantArg(arg: string): boolean {
  const trimmed = arg.trim();
  if (trimmed === "") return false;

  // Collapse all string literals to empty quotes so a token like
  // `'"select":"all"'` inside metadata can't false-positive the boundary
  // regex below. Same trick we already use elsewhere — kept inline rather
  // than refactoring `stripComments` because we only need it for the arg
  // body, not the whole file.
  const stripped = trimmed
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    // backtick template literals can contain newlines/expressions, so be more
    // conservative — replace the whole thing through to the closing backtick.
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");

  // Walk the stripped argument body and only consider keys at brace-depth 1
  // (i.e. top-level keys of the args object literal — the body starts with
  // `{`, which pushes depth to 1, and any nested `{ ... }` pushes deeper).
  // Anything at depth ≥ 2 is by definition a nested filter and doesn't
  // satisfy projection.
  let depth = 0;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === "{") {
      depth++;
      continue;
    }
    if (ch === "}") {
      depth--;
      continue;
    }
    if (depth !== 1) continue;
    // At top level of the args object. Look for `select` or `omit` followed
    // by optional space then a colon. Anchor on a word boundary so we don't
    // match `preselect:` or `omitted:`.
    const prev = stripped[i - 1] ?? "";
    const isWordBoundary = !/[A-Za-z_$0-9]/.test(prev);
    if (!isWordBoundary) continue;
    if (stripped.startsWith("select", i)) {
      const after = stripped.slice(i + "select".length).trimStart();
      if (after.startsWith(":")) return true;
    }
    if (stripped.startsWith("omit", i)) {
      const after = stripped.slice(i + "omit".length).trimStart();
      if (after.startsWith(":")) return true;
    }
  }

  return false;
}

/**
 * Check whether the lines immediately above the findMany call carry an
 * `// audit-allow-findmany-no-select: <reason>` pragma. Only the directly
 * preceding non-blank line counts — scoping it narrowly stops one pragma
 * from silencing unrelated calls lower in the file.
 *
 * The pragma name is intentionally distinct from `audit-allow-findmany`
 * (the row-bound audit). The two audits cover different bug classes; reusing
 * one pragma for both would let the column-projection class slip through
 * unannotated.
 */
function hasAllowPragma(lines: string[], lineIdx: number): boolean {
  for (let i = lineIdx - 1; i >= 0; i--) {
    const ln = lines[i].trim();
    if (ln === "") continue;
    return /^\/\/\s*audit-allow-findmany-no-select\b/.test(ln);
  }
  return false;
}

/**
 * Locate `findMany` call-sites in `source` and return offenders (those that
 * lack both `select:` and `omit:` and are not covered by an
 * `audit-allow-findmany-no-select` pragma).
 */
export function auditSource(filePath: string, source: string): Offender[] {
  const offenders: Offender[] = [];
  const lines = source.split("\n");
  const scanned = stripComments(source);

  const lineStarts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") lineStarts.push(i + 1);
  }

  // Per-model occurrence counter, scoped to this file. See audit-findmany-no-
  // take.ts for the reasoning — keying on syntactic occurrence keeps the
  // baseline stable under code wrapping.
  const perModelIndex = new Map<string, number>();

  FINDMANY_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FINDMANY_RE.exec(scanned))) {
    const callStart = match.index;
    const modelName = match[1];
    const parenIdx = match.index + match[0].length - 1;
    const arg = argBody(scanned, parenIdx);

    const occurrenceIndex = perModelIndex.get(modelName) ?? 0;
    perModelIndex.set(modelName, occurrenceIndex + 1);

    if (isCompliantArg(arg)) continue;

    let lineNum = 1;
    for (let i = 0; i < lineStarts.length; i++) {
      if (lineStarts[i] > callStart) break;
      lineNum = i + 1;
    }

    if (hasAllowPragma(lines, lineNum - 1)) continue;

    const snippetLine = lines[lineNum - 1]?.trim() ?? "";
    offenders.push({
      path: filePath,
      line: lineNum,
      snippet: snippetLine.slice(0, 160),
      modelName,
      occurrenceIndex,
    });
  }

  return offenders;
}

/**
 * Produce the stable baseline key for an offender:
 * `<path>::<modelName>::<occurrenceIndex>`.
 */
export function offenderKey(o: Offender): string {
  return `${o.path}::${o.modelName}::${o.occurrenceIndex}`;
}

// ─── CLI entry-point ────────────────────────────────────────────

const DEFAULT_ROOT = path.resolve(process.cwd());
const INCLUDE_EXTS = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".vercel",
  ".worktrees",
  ".claude",
  "docs",
]);

async function collectFiles(root: string, out: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== "." && entry.name !== "..") {
      if (SKIP_DIRS.has(entry.name)) continue;
    }
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await collectFiles(full, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (!INCLUDE_EXTS.has(ext)) continue;
      if (entry.name.endsWith(".d.ts")) continue;
      // Skip the audit script itself and its unit test, both of which are
      // intentionally full of `findMany` strings that would otherwise self-
      // trigger.
      if (full.endsWith("/audit-findmany-no-select.ts")) continue;
      if (full.endsWith("/audit-findmany-no-select.test.ts")) continue;
      // Sibling audit (`-no-take`) also contains literal findMany examples in
      // its own test fixtures — must not be scanned by this audit either.
      if (full.endsWith("/audit-findmany-no-take.ts")) continue;
      if (full.endsWith("/audit-findmany-no-take.test.ts")) continue;
      if (full.endsWith("/audit-findmany-rekey.test.ts")) continue;
      out.push(full);
    }
  }
  return out;
}

interface BaselineFile {
  /**
   * Set of `path::modelName::occurrenceIndex` keys captured at baseline time.
   * Anything present here is silenced; anything not present is a new offender
   * and fails CI. The baseline can only shrink over time, never grow.
   */
  allowlist: string[];
}

const BASELINE_FILE = ".audit-findmany-no-select-baseline.json";

async function loadBaseline(root: string): Promise<Set<string>> {
  const file = path.join(root, BASELINE_FILE);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as BaselineFile;
    return new Set(parsed.allowlist ?? []);
  } catch {
    return new Set();
  }
}

async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const writeBaseline =
    args.includes("--write-baseline") || args.includes("--update-baseline");
  const showAll = args.includes("--all");
  const rootArg = args.find((a) => !a.startsWith("--"));
  const root = rootArg ? path.resolve(rootArg) : DEFAULT_ROOT;
  const files = await collectFiles(root);

  const allOffenders: Offender[] = [];
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    if (!source.includes(".findMany(")) continue;
    const rel = path.relative(root, file);
    const offenders = auditSource(rel, source);
    allOffenders.push(...offenders);
  }

  if (writeBaseline) {
    const keys = Array.from(new Set(allOffenders.map(offenderKey))).sort();
    const out: BaselineFile = { allowlist: keys };
    await fs.writeFile(
      path.join(root, BASELINE_FILE),
      JSON.stringify(out, null, 2) + "\n",
      "utf8",
    );
    // eslint-disable-next-line no-console
    console.log(
      `audit-findmany-no-select: wrote baseline with ${keys.length} entries`,
    );
    process.exit(0);
  }

  const baseline = await loadBaseline(root);
  const newOffenders = showAll
    ? allOffenders
    : allOffenders.filter((o) => !baseline.has(offenderKey(o)));

  if (newOffenders.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      showAll
        ? `audit-findmany-no-select: ${allOffenders.length} offender(s) (--all, baseline ignored)`
        : `audit-findmany-no-select: no new offenders${baseline.size ? ` (${baseline.size} grandfathered)` : ""}`,
    );
    process.exit(0);
  }

  for (const o of newOffenders) {
    // eslint-disable-next-line no-console
    console.log(`${o.path}:${o.line}  ${o.snippet}`);
  }
  // eslint-disable-next-line no-console
  console.log(
    `\n${newOffenders.length} new offender(s) not covered by ${BASELINE_FILE}`,
  );
  process.exit(1);
}

// Only run the CLI when invoked directly. Vitest imports this module in-process
// and should NOT trigger the scan.
const invokedDirectly = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  runCli().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(2);
  });
}
