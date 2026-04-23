#!/usr/bin/env tsx
/**
 * audit-findmany-no-take
 * ──────────────────────
 * Static check that every `prisma.<model>.findMany(...)` in the repo either
 *   1. passes an explicit `take:` so the payload is bounded, OR
 *   2. filters by a unique column (`id` / `animalId` / `slug` / `email` /
 *      `fingerprint` / `dedupeKey`) so the result set is known to contain
 *      ≤1 row, OR
 *   3. is preceded by an `// audit-allow-findmany:` comment that documents a
 *      deliberate full-scan (bulk analytics, migrations, seed scripts), OR
 *   4. is listed in the `.audit-findmany-baseline.json` file (known
 *      legacy offenders pending migration).
 *
 * Offenders stream out on stdout with `path:line snippet`, and the process
 * exits non-zero so CI can gate PRs. New offenders outside the baseline
 * fail the build — the baseline can only shrink over time, never grow.
 *
 * The analyser (`auditSource`) is exported for unit tests; the CLI portion
 * below only runs when the file is invoked directly. Keep them separate so
 * tests stay hermetic.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface Offender {
  path: string;
  line: number;
  snippet: string;
}

const FINDMANY_RE = /prisma\.(\w+)\.findMany\s*\(/g;

/**
 * Walk balanced curly braces starting at `open` (an index pointing at `{`)
 * and return the index of the matching `}`. Returns -1 if unbalanced. Tracks
 * string literals and line comments so braces inside `"{ foo }"` don't
 * confuse the scan.
 */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const ch = src[i];
    // Skip line comments so `// { }` doesn't shift depth.
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    // Skip block comments.
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length - 1 && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // Skip string literals (single, double, backtick). Handles escapes.
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
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Find the first `(` after `start`; return -1 if none before EOF.
 */
function findOpenParen(src: string, start: number): number {
  let i = start;
  while (i < src.length && src[i] !== "(") i++;
  return i < src.length ? i : -1;
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
 * findMany is compliant.
 */
function isCompliantArg(arg: string): boolean {
  const trimmed = arg.trim();
  if (trimmed === "") return false;

  // `take: <n>` anywhere wins. Ignore matches inside string literals by
  // requiring a preceding `{`, `,`, or newline boundary.
  if (/(^|[\s,{])take\s*:/m.test(trimmed)) return true;

  // Unique-column `where:` — look for `where: { <unique>: ... }`.
  // Only keys that are globally unique on the target model are allowed here.
  // Anything broader (`campId`, `mobId`, etc.) is a foreign-key filter on
  // the *other* side and returns many rows, so those must carry a `take:`
  // or an `audit-allow-findmany` pragma to justify the full scan.
  const uniqueKeyRe = /\bwhere\s*:\s*\{[^}]*\b(id|animalId|slug|email|fingerprint|dedupeKey)\s*:/;
  if (uniqueKeyRe.test(trimmed)) return true;

  return false;
}

/**
 * Check whether the N lines immediately above the findMany call carry an
 * `// audit-allow-findmany: <reason>` pragma. Only the directly preceding
 * non-blank line counts — scoping it narrowly stops one pragma from
 * silencing unrelated calls lower in the file.
 */
function hasAllowPragma(lines: string[], lineIdx: number): boolean {
  for (let i = lineIdx - 1; i >= 0; i--) {
    const ln = lines[i].trim();
    if (ln === "") continue;
    return /^\/\/\s*audit-allow-findmany\b/.test(ln);
  }
  return false;
}

/**
 * Locate `findMany` call-sites in `source` and return offenders (those that
 * lack both an explicit `take:` and a unique-key `where:`, and are not
 * covered by an `audit-allow-findmany` pragma).
 */
export function auditSource(filePath: string, source: string): Offender[] {
  const offenders: Offender[] = [];
  const lines = source.split("\n");

  // Precompute line-start offsets so we can map a character index to a 1-based
  // line number without repeating a scan.
  const lineStarts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") lineStarts.push(i + 1);
  }

  FINDMANY_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FINDMANY_RE.exec(source))) {
    const callStart = match.index;
    // Look one char before the match for `prisma` — reject `.items.findMany`
    // off a non-prisma receiver. `FINDMANY_RE` already anchors on `prisma.`,
    // but narrow again to defend against regex surprise.
    // (This is belt-and-braces; the regex literal does the work.)
    const parenIdx = match.index + match[0].length - 1; // points at `(`
    const arg = argBody(source, parenIdx);

    if (isCompliantArg(arg)) continue;

    // Map character index → 1-based line number.
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
    });
  }

  return offenders;
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
      if (full.endsWith("/audit-findmany-no-take.ts")) continue;
      if (full.endsWith("/audit-findmany-no-take.test.ts")) continue;
      out.push(full);
    }
  }
  return out;
}

interface BaselineFile {
  /**
   * Set of `path:line` keys captured at baseline time. Anything present here
   * is silenced; anything not present is a new offender and fails CI.
   */
  allowlist: string[];
}

async function loadBaseline(root: string): Promise<Set<string>> {
  const file = path.join(root, ".audit-findmany-baseline.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as BaselineFile;
    return new Set(parsed.allowlist ?? []);
  } catch {
    return new Set();
  }
}

export function offenderKey(o: Offender): string {
  return `${o.path}:${o.line}`;
}

async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const updateBaseline = args.includes("--update-baseline");
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

  if (updateBaseline) {
    const keys = Array.from(new Set(allOffenders.map(offenderKey))).sort();
    const out: BaselineFile = { allowlist: keys };
    await fs.writeFile(
      path.join(root, ".audit-findmany-baseline.json"),
      JSON.stringify(out, null, 2) + "\n",
      "utf8",
    );
    // eslint-disable-next-line no-console
    console.log(`audit-findmany-no-take: wrote baseline with ${keys.length} entries`);
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
        ? `audit-findmany-no-take: ${allOffenders.length} offender(s) (--all, baseline ignored)`
        : `audit-findmany-no-take: no new offenders${baseline.size ? ` (${baseline.size} grandfathered)` : ""}`,
    );
    process.exit(0);
  }

  for (const o of newOffenders) {
    // eslint-disable-next-line no-console
    console.log(`${o.path}:${o.line}  ${o.snippet}`);
  }
  // eslint-disable-next-line no-console
  console.log(
    `\n${newOffenders.length} new offender(s) not covered by .audit-findmany-baseline.json`,
  );
  process.exit(1);
}

// Only run the CLI when invoked directly (`tsx scripts/audit-findmany-no-take.ts`).
// Vitest imports this module in-process and should NOT trigger the scan.
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
