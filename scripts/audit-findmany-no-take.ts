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
 * Baseline key format
 * ───────────────────
 * Each baseline entry is `path::modelName::occurrenceIndex` where
 *   - `path` is the repo-relative path,
 *   - `modelName` is the Prisma delegate (`animal`, `task`, ...),
 *   - `occurrenceIndex` is the 0-based index of this call among all
 *     `prisma.<modelName>.findMany(...)` calls in the file.
 *
 * This key is stable under pure line-drift (e.g. wrapping a call in
 * `timeAsync("query", () => ...)`) and only changes when the set of queried
 * models or the number of calls per model actually changes — exactly the
 * semantic we want for a "grandfathered offender" list.
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
 * This is the minimum correct preprocessor — it's not a full JS parser, but
 * it covers every realistic occurrence of `prisma.*.findMany` in our tree.
 */
function stripComments(src: string): string {
  const out: string[] = new Array(src.length);
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    // Line comment: replace `//…\n` with spaces, keep the newline.
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") {
        out[i] = " ";
        i++;
      }
      continue;
    }
    // Block comment: replace `/*…*/` with spaces, preserving newlines inside.
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
    // String literal: copy through verbatim so `"// …"` stays intact.
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
 *
 * Each offender carries a `modelName` and a 0-based `occurrenceIndex` scoped
 * to that model within this file — together with `path`, these form the
 * stable baseline key.
 */
export function auditSource(filePath: string, source: string): Offender[] {
  const offenders: Offender[] = [];
  const lines = source.split("\n");

  // Strip comments BEFORE scanning so a doc-comment showing the old shape of
  // a query (`// const x = await prisma.animal.findMany(...)`) doesn't get
  // regex-matched as a real call. Using a space-preserving strip keeps line
  // numbers + character indices aligned with the original source, so the
  // offender report still points at the right line if something *does*
  // match outside a comment.
  const scanned = stripComments(source);

  // Precompute line-start offsets so we can map a character index to a 1-based
  // line number without repeating a scan.
  const lineStarts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") lineStarts.push(i + 1);
  }

  // Per-model occurrence counter, scoped to this file. The scan walks source
  // top-down in regex-match order, so the first match for model X is index 0,
  // the second is index 1, and so on — independent of whether earlier matches
  // were compliant or allowlisted. Keying this way means compliance changes
  // (e.g. adding `take:` to the second call in a file) only invalidate entries
  // at the end of the per-model sequence, which is the minimum-surprise
  // behaviour for a grandfather list.
  const perModelIndex = new Map<string, number>();

  FINDMANY_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FINDMANY_RE.exec(scanned))) {
    const callStart = match.index;
    const modelName = match[1];
    const parenIdx = match.index + match[0].length - 1; // points at `(`
    const arg = argBody(scanned, parenIdx);

    // Assign the occurrence index first — it advances for every syntactic
    // `prisma.<model>.findMany(` regardless of later filtering, so that pragma
    // or compliance changes on an earlier call don't renumber later calls.
    const occurrenceIndex = perModelIndex.get(modelName) ?? 0;
    perModelIndex.set(modelName, occurrenceIndex + 1);

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

const NEW_KEY_RE = /^.+::[A-Za-z_$][\w$]*::\d+$/;
const LEGACY_KEY_RE = /^(.+):(\d+)$/;

/**
 * Migrate an array of baseline entries to the new `path::modelName::occurrenceIndex`
 * format. Old entries (`path:line`) are resolved by auditing the file at `path`
 * (read from the `repo` map) and matching the entry's line to an offender's
 * line. If no exact line match is found, the first offender in the file acts as
 * a fallback — line numbers in the baseline are frozen at capture time, and a
 * stale line that doesn't land on an offender is always a near-miss caused by
 * wrapping code (the whole reason for this migration).
 *
 * New-format entries pass through unchanged. Unresolvable entries are dropped;
 * they represent already-fixed code whose baseline row can be pruned.
 */
export function migrateBaselineEntries(
  entries: string[],
  repo: Map<string, string>,
): string[] {
  const migrated = new Set<string>();

  for (const entry of entries) {
    if (NEW_KEY_RE.test(entry)) {
      migrated.add(entry);
      continue;
    }
    const legacy = entry.match(LEGACY_KEY_RE);
    if (!legacy) continue;
    const [, filePath, lineStr] = legacy;
    const source = repo.get(filePath);
    if (source === undefined) continue;
    const offenders = auditSource(filePath, source);
    if (offenders.length === 0) continue;

    const targetLine = Number(lineStr);
    // Prefer an exact line-match (unchanged code). Otherwise, prefer the
    // nearest offender whose line is ≥ targetLine (P1's wrapping pushes
    // lines forward, never backward). Otherwise, fall back to the first
    // offender of the file.
    let chosen = offenders.find((o) => o.line === targetLine);
    if (!chosen) {
      chosen = offenders
        .filter((o) => o.line >= targetLine)
        .sort((a, b) => a.line - b.line)[0];
    }
    if (!chosen) chosen = offenders[0];

    migrated.add(offenderKey(chosen));
  }

  return Array.from(migrated).sort();
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
      if (full.endsWith("/audit-findmany-rekey.test.ts")) continue;
      // Sibling audit (column-projection, PR #140 / wave/138) — its source
      // and unit-test fixtures contain literal `prisma.<m>.findMany(...)`
      // strings that would otherwise self-trigger this row-bound check.
      if (full.endsWith("/audit-findmany-no-select.ts")) continue;
      if (full.endsWith("/audit-findmany-no-select.test.ts")) continue;
      // Sibling audit (species-axis, PR #239 / wave/224) — same reason as
      // the no-select pair above: the source + tests carry literal
      // `prisma.<model>.findMany(...)` fixture strings that would self-
      // trigger this row-bound check.
      if (full.endsWith("/audit-species-where.ts")) continue;
      if (full.endsWith("/audit-species-where.test.ts")) continue;
      // Architecture-test fixtures (one per sibling audit) that intentionally
      // contain violating prisma calls. They live under a stable directory
      // so we skip the whole tree rather than enumerate each fixture file;
      // future fixtures added to the dir are covered automatically.
      const normalised = full.split(path.sep).join("/");
      if (
        normalised.includes("/__tests__/architecture/audit-species-where-fixtures/")
      ) {
        continue;
      }
      out.push(full);
    }
  }
  return out;
}

interface BaselineFile {
  /**
   * Set of `path::modelName::occurrenceIndex` keys captured at baseline time.
   * Anything present here is silenced; anything not present is a new offender
   * and fails CI. Legacy `path:line` entries are still accepted by the
   * migrator (`--write-baseline`) but will be rejected by CI once rewritten.
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
      path.join(root, ".audit-findmany-baseline.json"),
      JSON.stringify(out, null, 2) + "\n",
      "utf8",
    );
    // eslint-disable-next-line no-console
    console.log(
      `audit-findmany-no-take: wrote baseline with ${keys.length} entries`,
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
