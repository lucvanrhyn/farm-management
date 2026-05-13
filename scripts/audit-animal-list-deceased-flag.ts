#!/usr/bin/env tsx
/**
 * audit-animal-list-deceased-flag
 * ───────────────────────────────
 * Static check that every per-species animal LIST/SEARCH query commits
 * to a lifecycle (status) decision rather than silently inheriting one.
 * Sibling of `audit-species-where` (species axis) and the pagination
 * audits. This audit covers the deceased-rows-leaking-out class.
 *
 * Why this exists
 * ───────────────
 * Issue #255 (Wave 4 of PRD #250). 2026-05-13 production stress test:
 * a developer can write
 *
 *     const animals = await scoped(prisma, mode).animal.findMany({});
 *
 * and ship a catalogue / search / mortality-list surface that silently
 * EXCLUDES every deceased row, because the species-scoped facade
 * (`lib/server/species-scoped-prisma.ts`) injects `status: "Active"` by
 * default. The call typechecks, returns rows, and code review can't
 * catch it. SARS para-13A and IT3 require deceased-animal traceability
 * for ≥5 years — silent exclusion is a regulatory bug, not just a UX
 * one.
 *
 * The structural cure is the `searchAnimals(...)` deep module
 * (`lib/server/animal-search.ts`) which requires `includeDeceased:
 * boolean` by signature. This audit closes the loop at every OTHER
 * call site by failing CI on raw `scoped(...).animal.findMany` (and
 * raw `prisma.animal.findMany`) that lacks an explicit `status:`
 * predicate.
 *
 * Compliant patterns:
 *   1. The call carries `status:` explicitly inside `where` (any value
 *      — `"Active"`, `"Sold"`, `"Deceased"`, `{ in: [...] }` — counts
 *      as a deliberate lifecycle choice).
 *   2. The call goes through `searchAnimals(...)` from
 *      `lib/server/animal-search.ts` (signature requires `includeDeceased`).
 *   3. The call is preceded by an `// audit-allow-deceased-flag: <reason>`
 *      comment that documents a deliberate cross-status read.
 *   4. The call is grandfathered in
 *      `.audit-animal-list-deceased-flag-baseline.json`.
 *
 * Scope
 * ─────
 * - `findMany` only. `count`, `findFirst`, `findUnique` aren't covered:
 *     - `count` opts into status by adding it; the species-axis audit
 *       handles its species half.
 *     - `findFirst`/`findUnique` target single rows by primary key —
 *       they're lookups, not lists, so the lifecycle axis doesn't
 *       carry the same silent-exclusion risk.
 *   - `groupBy` is excluded too — it usually slices BY status as a
 *     dimension and the bug class doesn't apply.
 *
 * Baseline key format: `path::callShape::operation::occurrenceIndex`
 * — stable under pure line-drift. Mirror of `audit-species-where`.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface Offender {
  path: string;
  line: number;
  snippet: string;
  /**
   * Where the call landed: `scoped` for `scoped(...).animal.findMany`
   * or `raw` for `prisma.animal.findMany`. Tracked separately so the
   * baseline key reflects which path the offender came from.
   */
  callShape: 'scoped' | 'raw';
  operation: string;
  occurrenceIndex: number;
}

const AUDITED_OPS = new Set(['findMany']);

/** The receiver patterns we scan for. */
const SCOPED_RE = /scoped\([^)]*\)\.animal\.(\w+)\s*\(/g;
const RAW_RE = /\bprisma\.animal\.(\w+)\s*\(/g;

/**
 * Replace `//` and block comments with whitespace of equal length so
 * the regex scan can't match tokens inside comments. Identical strategy
 * to `audit-species-where` and `audit-findmany-no-select`.
 */
function stripComments(src: string): string {
  const out: string[] = new Array(src.length);
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
      continue;
    }
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
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out[i] = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') {
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
  return out.join('');
}

/** Return the balanced-paren argument body starting at the `(` index. */
function argBody(src: string, open: number): string {
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i += 2;
        else i++;
      }
      i++;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
    i++;
  }
  return '';
}

/**
 * Inspect whether the args body for a `findMany` call carries a
 * top-level `status:` key inside its `where` clause.
 *
 * Walks the arg body brace-aware so we only consider `status:` at the
 * top level of `where: { ... }`.
 */
function hasStatusInWhere(arg: string): boolean {
  if (arg.trim() === '') return false;

  const stripped = arg
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

  let depth = 0;
  let i = 0;
  while (i < stripped.length) {
    const ch = stripped[i];
    if (ch === '{') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}') {
      depth--;
      i++;
      continue;
    }

    // Match `where:` only at args-top-level (depth === 1).
    if (depth === 1) {
      const prev = stripped[i - 1] ?? '';
      const isWordBoundary = !/[A-Za-z_$0-9]/.test(prev);
      if (isWordBoundary && stripped.startsWith('where', i)) {
        const afterWhere = stripped.slice(i + 'where'.length).trimStart();
        if (afterWhere.startsWith(':')) {
          const colonOffset =
            i +
            'where'.length +
            (stripped.slice(i + 'where'.length).length - afterWhere.length);
          let j = colonOffset + 1;
          while (j < stripped.length && /\s/.test(stripped[j])) j++;

          if (stripped[j] === '{') {
            const innerStart = j + 1;
            let innerDepth = 1;
            let k = innerStart;
            while (k < stripped.length && innerDepth > 0) {
              if (stripped[k] === '{') innerDepth++;
              else if (stripped[k] === '}') innerDepth--;
              if (innerDepth === 1) {
                const prevInner = stripped[k - 1] ?? '';
                const isInnerBoundary = !/[A-Za-z_$0-9]/.test(prevInner);
                if (isInnerBoundary && stripped.startsWith('status', k)) {
                  const tail = stripped.slice(k + 'status'.length).trimStart();
                  if (tail.startsWith(':')) return true;
                }
              }
              k++;
            }
          }
          // We've found `where:` at the top level; whether compliant or
          // not, only one `where:` per args object — stop.
          return false;
        }
      }
    }

    i++;
  }

  return false;
}

/**
 * Check whether the call carries an `// audit-allow-deceased-flag: <reason>`
 * pragma above it. Walks past blank lines AND past sibling-audit pragma
 * lines (`// audit-allow-…` from any other audit) so a callsite that needs
 * to silence both audits at once (e.g. the AnimalSearchQuery internals
 * that both centralise species AND legitimately span lifecycle) can stack
 * its pragmas without one masking the other.
 *
 * Pragma name is distinct from the other audits — only the
 * `audit-allow-deceased-flag` literal silences this audit.
 */
function hasAllowPragma(lines: string[], lineIdx: number): boolean {
  for (let i = lineIdx - 1; i >= 0; i--) {
    const ln = lines[i].trim();
    if (ln === '') continue;
    if (/^\/\/\s*audit-allow-deceased-flag\b/.test(ln)) return true;
    // Skip sibling-audit pragmas so they don't end the walk before we
    // find ours. Only stop the walk on real (non-pragma, non-blank) code.
    if (/^\/\/\s*audit-allow-/.test(ln)) continue;
    return false;
  }
  return false;
}

/**
 * Locate per-species animal list call-sites in `source` and return
 * offenders (those that lack an explicit `status:` predicate and aren't
 * covered by an inline pragma).
 */
export function auditSource(filePath: string, source: string): Offender[] {
  const offenders: Offender[] = [];
  const lines = source.split('\n');
  const scanned = stripComments(source);

  const lineStarts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') lineStarts.push(i + 1);
  }

  function findLine(callStart: number): number {
    let lineNum = 1;
    for (let i = 0; i < lineStarts.length; i++) {
      if (lineStarts[i] > callStart) break;
      lineNum = i + 1;
    }
    return lineNum;
  }

  function scan(re: RegExp, callShape: 'scoped' | 'raw'): void {
    const perOpIndex = new Map<string, number>();
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(scanned))) {
      const callStart = match.index;
      const operation = match[1];
      if (!AUDITED_OPS.has(operation)) continue;

      const parenIdx = match.index + match[0].length - 1;
      const arg = argBody(scanned, parenIdx);

      const key = `${callShape}.${operation}`;
      const occurrenceIndex = perOpIndex.get(key) ?? 0;
      perOpIndex.set(key, occurrenceIndex + 1);

      if (hasStatusInWhere(arg)) continue;

      const lineNum = findLine(callStart);
      if (hasAllowPragma(lines, lineNum - 1)) continue;

      const snippetLine = lines[lineNum - 1]?.trim() ?? '';
      offenders.push({
        path: filePath,
        line: lineNum,
        snippet: snippetLine.slice(0, 160),
        callShape,
        operation,
        occurrenceIndex,
      });
    }
  }

  scan(SCOPED_RE, 'scoped');
  scan(RAW_RE, 'raw');

  return offenders;
}

/** Produce the stable baseline key. */
export function offenderKey(o: Offender): string {
  return `${o.path}::${o.callShape}::${o.operation}::${o.occurrenceIndex}`;
}

// ─── CLI entry-point ────────────────────────────────────────────

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
 * Path prefixes that are out-of-scope for the audit. Each entry is a
 * path-relative substring; if any appears in the file path the file is
 * skipped. One-way ratchet — every entry should be justified inline.
 */
const ALLOWLIST_PATHS: string[] = [
  // The deep module itself reads every status bucket to compose the
  // `{ active, sold, deceased }` count tuple. It IS the canonical
  // path; allowing it via path is cleaner than peppering its body
  // with pragmas.
  'lib/server/animal-search.ts',
  'lib/server/__tests__/animal-search.test.ts',
  '__tests__/lib/server/animal-search.test.ts',

  // The species-scoped facade dispatches to `prisma.animal.<op>` from
  // inside its own builders — those calls inject status by default
  // (the very behaviour this audit complements). Scanning the facade
  // itself would self-trigger; the bug class lives at FACADE CALL
  // SITES, not inside the facade body.
  'lib/server/species-scoped-prisma.ts',
  'lib/server/__tests__/species-scoped-prisma.test.ts',

  // Backfill / migration scripts read every animal regardless of
  // lifecycle to write derived columns. Same exception model the
  // species-where audit uses.
  'scripts/backfill-animal-species.ts',
  'scripts/einstein-backfill-embeddings.ts',
  'scripts/audit-schema-parity.ts',

  // Audit scripts / sibling tests / fixtures contain literal
  // `prisma.animal.findMany` strings as test data — they would
  // self-trigger.
  'scripts/audit-animal-list-deceased-flag.ts',
  'scripts/__tests__/audit-animal-list-deceased-flag.test.ts',
  '__tests__/scripts/audit-animal-list-deceased-flag.test.ts',
  'scripts/audit-species-where.ts',
  'scripts/__tests__/audit-species-where.test.ts',
  '__tests__/architecture/audit-species-where-fixtures/',
  'scripts/audit-findmany-no-select.ts',
  'scripts/audit-findmany-no-take.ts',
  'scripts/__tests__/audit-findmany-no-select.test.ts',
  'scripts/__tests__/audit-findmany-no-take.test.ts',

  // Cross-status by design — Farm Einstein RAG retrieves across every
  // lifecycle so the assistant can reason about historical mortality.
  'lib/einstein/',

  // Inngest cron functions iterate farm-wide notifications across every
  // lifecycle (e.g. "withdrawal expiry on every animal that's still
  // in scope").
  'lib/inngest/',
];

/**
 * Per-file suffixes that opt the file out of the audit. Same convention
 * as `audit-species-where`: Vitest specs commonly use mocked prisma
 * calls as fixtures and aren't real production-code paths.
 */
const SKIP_FILE_SUFFIXES = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];

function isInAllowlist(relPath: string): boolean {
  const normalised = relPath.split(path.sep).join('/');
  if (SKIP_FILE_SUFFIXES.some((s) => normalised.endsWith(s))) return true;
  return ALLOWLIST_PATHS.some((entry) => normalised.includes(entry));
}

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
      out.push(full);
    }
  }
  return out;
}

interface BaselineFile {
  /**
   * Set of `path::callShape::operation::occurrenceIndex` keys captured
   * at baseline time. Anything present is silenced; anything not present
   * is a NEW offender and fails CI. The baseline can only shrink.
   */
  allowlist: string[];
}

const BASELINE_FILE = '.audit-animal-list-deceased-flag-baseline.json';

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

  const allOffenders: Offender[] = [];
  for (const file of files) {
    const rel = path.relative(root, file);
    if (isInAllowlist(rel)) continue;
    const source = await fs.readFile(file, 'utf8');
    // Cheap pre-filter — skip files that don't mention the receivers.
    if (!source.includes('.animal.findMany')) continue;
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
    console.log(
      `audit-animal-list-deceased-flag: wrote baseline with ${keys.length} entries`,
    );
    process.exit(0);
  }

  const baseline = await loadBaseline(root);
  const newOffenders = showAll
    ? allOffenders
    : allOffenders.filter((o) => !baseline.has(offenderKey(o)));

  if (newOffenders.length === 0) {
    console.log(
      showAll
        ? `audit-animal-list-deceased-flag: ${allOffenders.length} offender(s) (--all, baseline ignored)`
        : `audit-animal-list-deceased-flag: no new offenders${baseline.size ? ` (${baseline.size} grandfathered)` : ''}`,
    );
    process.exit(0);
  }

  for (const o of newOffenders) {
    console.log(
      `${o.path}:${o.line}  ${o.callShape === 'scoped' ? 'scoped(...).animal' : 'prisma.animal'}.${o.operation} — ${o.snippet}`,
    );
  }
  console.log(
    `\n${newOffenders.length} new offender(s) not covered by ${BASELINE_FILE}`,
  );
  console.log(
    'Either route through `searchAnimals(...)` (lib/server/animal-search.ts) with an explicit\n' +
      '`includeDeceased: boolean` flag, add an explicit `status:` predicate to the call, or\n' +
      'silence with `// audit-allow-deceased-flag: <reason>` if the cross-status read is intentional.',
  );
  process.exit(1);
}

const invokedDirectly = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  runCli().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
