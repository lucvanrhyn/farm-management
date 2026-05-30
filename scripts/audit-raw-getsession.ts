#!/usr/bin/env tsx
/**
 * audit-raw-getsession
 * ────────────────────
 * Static ban-rule that prevents new raw `getServerSession(authOptions)` calls
 * from being added outside the approved helpers.
 *
 * WHY this exists (#522 / PRD #521 / umbrella #114)
 * ─────────────────────────────────────────────────
 * After the Phase D/G session-consolidation work, `getServerSession` should
 * only appear in:
 *
 *   1. `lib/auth.ts`                   — the canonical `getSession()` wrapper.
 *   2. `lib/server/farm-context-slug.ts` — legacy fast-path fallback.
 *   3. `lib/server/farm-context-errors.ts` — error-classifier helper.
 *   4. A handful of API routes that legitimately need the raw session.
 *   5. Page/layout files being migrated to `requireSession()` in #523.
 *
 * Any NEW file adding `getServerSession` outside those known sites is a
 * regression — this script flags it so CI fails before it reaches production.
 *
 * The `.audit-raw-getsession-baseline.json` file grandfathers current
 * legitimate (or pending-migration) sites. The baseline can only shrink:
 * as #523 migrates page files, each entry is removed from the allowlist and
 * CI will enforce the contracted reduction.
 *
 * Baseline key format
 * ───────────────────
 * `<relative-path>::<occurrenceIndex>` — stable under pure line-drift.
 *
 * The analyser (`auditSource`) is exported for unit tests; the CLI portion
 * only runs when the file is invoked directly.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ─── Public types ──────────────────────────────────────────────────────────

export interface RawSessionOffender {
  path: string;
  line: number;
  snippet: string;
  occurrenceIndex: number;
}

// ─── Detection patterns ────────────────────────────────────────────────────

/**
 * Matches `getServerSession(` calls (the actual function invocation).
 * We look for the function name followed immediately by `(` to avoid
 * matching comments or doc-string references like "calls getServerSession".
 */
const CALL_RE = /getServerSession\s*\(/g;

/**
 * Strip `//` line-comments, `/* … *\/` block-comments, AND string literal
 * contents from source, preserving line structure (newlines stay in place).
 *
 * String contents are replaced with spaces so that `"getServerSession("` or
 * a doc comment mentioning the function doesn't get classified as a live call.
 * The string delimiters themselves are kept in place so the scan target is
 * syntactically intact; only the content is blanked.
 */
function stripCommentsAndStrings(src: string): string {
  const out: string[] = new Array(src.length);
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    // Line comment
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
      continue;
    }
    // Block comment
    if (ch === '/' && src[i + 1] === '*') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      while (i < src.length - 1 && !(src[i] === '*' && src[i + 1] === '/')) {
        out[i] = src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < src.length - 1) {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
      }
      continue;
    }
    // String literals — blank the CONTENT (not the delimiters)
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out[i] = ch; // keep opening delimiter
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') {
          // Escaped char — blank both the backslash and the escaped character
          out[i] = ' ';
          if (i + 1 < src.length) out[i + 1] = ' ';
          i += 2;
        } else {
          // Preserve newlines so line numbers stay correct; blank everything else
          out[i] = src[i] === '\n' ? '\n' : ' ';
          i++;
        }
      }
      if (i < src.length) {
        out[i] = ch; // keep closing delimiter
        i++;
      }
      continue;
    }
    out[i] = ch;
    i++;
  }
  return out.join('');
}

/**
 * Scan `source` for raw `getServerSession(` calls (outside comments/strings)
 * and return an offender record for each occurrence.
 *
 * Note: exemption by file path is handled by the CLI caller, not here — the
 * same way `audit-findmany-no-select.ts` works. `auditSource` is pure: it
 * returns all occurrences found in the source regardless of path.
 */
export function auditSource(filePath: string, source: string): RawSessionOffender[] {
  const offenders: RawSessionOffender[] = [];
  const scanned = stripCommentsAndStrings(source);

  // Build line-start offset table for char→line conversion.
  const lineStarts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') lineStarts.push(i + 1);
  }

  let occurrenceIndex = 0;
  CALL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CALL_RE.exec(scanned)) !== null) {
    const callStart = match.index;

    // Binary-search for the line number of this occurrence.
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= callStart) lo = mid;
      else hi = mid - 1;
    }
    const lineNum = lo + 1; // 1-based

    const lines = source.split('\n');
    const snippetLine = (lines[lineNum - 1] ?? '').trim();

    offenders.push({
      path: filePath,
      line: lineNum,
      snippet: snippetLine.slice(0, 160),
      occurrenceIndex: occurrenceIndex++,
    });
  }

  return offenders;
}

/**
 * Produce the stable baseline key for an offender: `<path>::<occurrenceIndex>`.
 * Keying on path + occurrence index (not line number) keeps the baseline
 * stable when surrounding code is reformatted.
 */
export function offenderKey(o: RawSessionOffender): string {
  return `${o.path}::${o.occurrenceIndex}`;
}

// ─── CLI entry-point ───────────────────────────────────────────────────────

const DEFAULT_ROOT = path.resolve(process.cwd());
const INCLUDE_EXTS = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.vercel',
  '.worktrees',
  '.claude',
  'docs',
]);

/**
 * The canonical wrapper file — this is the ONE PLACE that is ALWAYS exempt,
 * by definition: it IS the wrapper that every other file should call instead.
 * We skip it before even calling auditSource (no baseline entry needed).
 */
const ALWAYS_EXEMPT_SUFFIX = path.join('lib', 'auth.ts');

async function collectFiles(root: string, out: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.' && entry.name !== '..') {
      if (SKIP_DIRS.has(entry.name)) continue;
    }
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await collectFiles(full, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (!INCLUDE_EXTS.has(ext)) continue;
      if (entry.name.endsWith('.d.ts')) continue;
      // Skip the audit script itself and its test — they contain literal
      // `getServerSession(` strings that would self-trigger.
      if (full.endsWith('/audit-raw-getsession.ts')) continue;
      if (full.endsWith('/audit-raw-getsession.test.ts')) continue;
      out.push(full);
    }
  }
  return out;
}

interface BaselineFile {
  /**
   * Set of `path::occurrenceIndex` keys captured at baseline time.
   * Entries here are silenced. Anything NOT in the baseline is a new
   * offender and fails CI. The baseline can only shrink over time.
   *
   * comment: optional human-readable note explaining why this site is exempt.
   */
  allowlist: string[];
}

const BASELINE_FILE = '.audit-raw-getsession-baseline.json';

async function loadBaseline(root: string): Promise<Set<string>> {
  const file = path.join(root, BASELINE_FILE);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as BaselineFile;
    return new Set(parsed.allowlist ?? []);
  } catch {
    return new Set();
  }
}

async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const writeBaseline =
    args.includes('--write-baseline') || args.includes('--update-baseline');
  const showAll = args.includes('--all');
  const rootArg = args.find((a) => !a.startsWith('--'));
  const root = rootArg ? path.resolve(rootArg) : DEFAULT_ROOT;
  const files = await collectFiles(root);

  const allOffenders: RawSessionOffender[] = [];
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    // Quick guard — skip files that don't even mention the token
    if (!source.includes('getServerSession')) continue;
    const rel = path.relative(root, file);
    // The canonical wrapper is always exempt — never scan it
    if (rel === ALWAYS_EXEMPT_SUFFIX || file.endsWith(ALWAYS_EXEMPT_SUFFIX)) continue;
    const offenders = auditSource(rel, source);
    allOffenders.push(...offenders);
  }

  if (writeBaseline) {
    const keys = Array.from(new Set(allOffenders.map(offenderKey))).sort();
    const out: BaselineFile = { allowlist: keys };
    await fs.writeFile(
      path.join(root, BASELINE_FILE),
      JSON.stringify(out, null, 2) + '\n',
      'utf8',
    );
    // eslint-disable-next-line no-console
    console.log(
      `audit-raw-getsession: wrote baseline with ${keys.length} entries`,
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
        ? `audit-raw-getsession: ${allOffenders.length} offender(s) (--all, baseline ignored)`
        : `audit-raw-getsession: no new offenders${baseline.size ? ` (${baseline.size} grandfathered)` : ''}`,
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

// Only run the CLI when invoked directly.
const invokedDirectly = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
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
