#!/usr/bin/env tsx
/**
 * audit-species-where
 * ───────────────────
 * Static check that every per-species `prisma.<model>.<op>` call commits
 * to the species axis. Sibling of `audit-findmany-no-take` (row bounds)
 * and `audit-findmany-no-select` (column bounds). This audit covers the
 * cross-species-leak class.
 *
 * Compliant patterns:
 *   1. The args carry a top-level `species:` key in the `where` clause,
 *      e.g. `prisma.animal.findMany({ where: { species: mode } })`.
 *   2. The args use a recognised species-injecting helper at the
 *      top-level of `where`, e.g.
 *      `prisma.animal.findMany({ where: activeSpeciesWhere(mode) })`.
 *   3. The call is preceded by an
 *      `// audit-allow-species-where: <reason>` comment that documents
 *      a deliberate cross-species span (e.g. dashboard farm-wide total).
 *   4. The call is grandfathered in `.audit-species-where-baseline.json`
 *      (known existing offenders pending migration to the facade).
 *
 * Calls routed through `scoped(prisma, mode).<model>.<op>(...)` are
 * compliant by construction — the facade injects species before
 * dispatching to the underlying client, so the call literal doesn't
 * match the `prisma.<model>` receiver regex this audit scans for.
 *
 * Why this exists
 * ───────────────
 * PRD #222 / issue #224. On a multi-species tenant, a per-species page
 * (admin animal list, camp panel, mob picker) reads the active mode from
 * the `farmtrack-mode-<slug>` cookie and is expected to filter Prisma
 * reads by that mode. Pre-#224, every callsite did this manually:
 *
 *     const mode = await getFarmMode(slug);
 *     const animals = await prisma.animal.findMany({
 *       where: { species: mode, status: "Active" },
 *     });
 *
 * Forgetting the `species: mode` predicate is a silent bug: the call
 * still typechecks, still returns rows, but the rows are cross-species
 * leakage. Code review cannot reliably catch this — there is no error.
 * The facade (`lib/server/species-scoped-prisma.ts`) makes "forgetting
 * mode" a compile error at the new call sites. This audit closes the
 * loop at every OTHER call site by failing CI on any raw
 * `prisma.<perSpeciesModel>.<op>` that lacks the species axis.
 *
 * Per-species models: animal, camp, mob, observation. Models like
 * `transaction`, `farmSettings`, `notification`, etc. are farm-scoped
 * not species-scoped and are excluded from the audit.
 *
 * Allowlist (cross-species by design)
 * ───────────────────────────────────
 * Some surfaces legitimately span species and MUST not be flagged:
 *   - `lib/einstein/**`     — Farm Einstein RAG retrieves across species.
 *   - `lib/inngest/**`      — notification cron operates on every species.
 *   - `lib/server/financial-analytics.ts` — finance roll-up is farm-wide.
 *   - `lib/server/cached.ts` — dashboard groupBy by species feeds the
 *     per-species split UI; reads must span species so the groupBy works.
 *
 * These paths are filtered out at scan time. Any other deliberate cross-
 * species call uses the inline `// audit-allow-species-where:` pragma.
 *
 * Baseline key format
 * ───────────────────
 * `path::modelName::operation::occurrenceIndex` — stable under pure
 * line-drift. Mirror of `audit-findmany-no-select.ts`.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface Offender {
  path: string;
  line: number;
  snippet: string;
  modelName: string;
  operation: string;
  occurrenceIndex: number;
}

/**
 * Per-species models that this audit covers. Everything else falls out
 * of scope — `prisma.transaction.findMany(...)` is not flagged because
 * Transaction has no `species` column.
 */
const PER_SPECIES_MODELS = new Set(['animal', 'camp', 'mob', 'observation']);

/**
 * Operations subject to the audit. Mutates (`update`/`delete`) operate
 * on a single row by primary key — they aren't covered because a primary
 * key uniquely identifies the row regardless of species. The cross-row
 * mutate variants (`updateMany`/`deleteMany`) ARE covered because they
 * filter by `where` and can silently span species.
 */
const AUDITED_OPS = new Set([
  'findMany',
  'findFirst',
  'count',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

/**
 * Helper functions whose return value injects a top-level `species:` key
 * into the `where` clause. If the audit sees `where: activeSpeciesWhere(mode)`
 * it counts the call as compliant — the helper is the single source of
 * truth for the species + Active predicate (see
 * `lib/animals/active-species-filter.ts`).
 *
 * Add entries here when a new wrapper that returns `{ species, ... }` is
 * introduced. Keep this list short and deliberate — every entry is a
 * codepath we trust to inject species.
 */
const SPECIES_HELPER_FUNCTIONS = ['activeSpeciesWhere'];

const CALL_RE = /prisma\.(\w+)\.(\w+)\s*\(/g;

/**
 * Replace `//` and `/* … *\/` comments with spaces of equal length so
 * regex scans can't match tokens inside comments. Identical strategy to
 * `audit-findmany-no-select`.
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
 * Inspect whether the args body for a Prisma operation carries a
 * top-level `species:` key inside its `where` clause.
 *
 * Walks the arg body brace-aware so we only consider `species:` at the
 * top level of `where: { ... }` — a `species` literal nested in a
 * metadata blob or a relation filter doesn't satisfy compliance.
 *
 * Recognises `where: <SpeciesHelper>(...)` as a compliant shortcut so
 * callers that already use the consolidated helper aren't punished for
 * not duplicating the literal predicate.
 */
function hasSpeciesInWhere(arg: string): boolean {
  if (arg.trim() === '') return false;

  // Collapse string literals so a string like '"species":"all"' inside a
  // metadata blob can't false-positive the boundary regex below.
  const stripped = arg
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

  // Find every top-level `where:` key in the args object. The args body
  // STARTS at depth 0 (the leading `{` of the args object pushes to 1,
  // top-level keys live at depth 1, the nested `where: { ... }` value
  // pushes to depth 2 — and species predicates at depth 2 are what we want).
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
          // Locate the value side of `where:` and inspect it.
          const colonOffset =
            i + 'where'.length + (stripped.slice(i + 'where'.length).length - afterWhere.length);
          // Skip past the colon and any whitespace to the first non-space char.
          let j = colonOffset + 1;
          while (j < stripped.length && /\s/.test(stripped[j])) j++;

          // Case 1: `where: { ... }` — scan the inner braces for `species:`.
          if (stripped[j] === '{') {
            const innerStart = j + 1;
            let innerDepth = 1;
            let k = innerStart;
            while (k < stripped.length && innerDepth > 0) {
              if (stripped[k] === '{') innerDepth++;
              else if (stripped[k] === '}') innerDepth--;
              if (innerDepth === 1) {
                // We're at the top level inside `where: { ... }`. Look for
                // a `species:` token here.
                const prevInner = stripped[k - 1] ?? '';
                const isInnerBoundary = !/[A-Za-z_$0-9]/.test(prevInner);
                if (isInnerBoundary && stripped.startsWith('species', k)) {
                  const tail = stripped.slice(k + 'species'.length).trimStart();
                  if (tail.startsWith(':')) return true;
                }
              }
              k++;
            }
          } else {
            // Case 2: `where: someHelper(...)` — check the identifier.
            // If the helper is in our recognised list, compliant.
            const helperMatch = stripped.slice(j).match(/^([A-Za-z_$][A-Za-z_$0-9]*)/);
            if (helperMatch && SPECIES_HELPER_FUNCTIONS.includes(helperMatch[1])) {
              return true;
            }
          }
          // We've found `where:` at the top level; whether compliant or
          // not, don't bother continuing — there's only one `where:` per
          // args object.
          return false;
        }
      }
    }

    i++;
  }

  return false;
}

/**
 * Check whether the line immediately above the call carries an
 * `// audit-allow-species-where: <reason>` pragma. Only the directly
 * preceding non-blank line counts.
 *
 * The pragma name is distinct from the other audit pragmas so allowing
 * one audit doesn't accidentally silence another (mirror of the
 * `audit-allow-findmany-no-select` design).
 */
function hasAllowPragma(lines: string[], lineIdx: number): boolean {
  for (let i = lineIdx - 1; i >= 0; i--) {
    const ln = lines[i].trim();
    if (ln === '') continue;
    return /^\/\/\s*audit-allow-species-where\b/.test(ln);
  }
  return false;
}

/**
 * Locate per-species `prisma.<model>.<op>` call-sites in `source` and
 * return offenders (those that lack a species predicate and are not
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

  const perModelOpIndex = new Map<string, number>();

  CALL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CALL_RE.exec(scanned))) {
    const callStart = match.index;
    const modelName = match[1];
    const operation = match[2];

    // Out-of-scope models / ops pass through silently.
    if (!PER_SPECIES_MODELS.has(modelName)) continue;
    if (!AUDITED_OPS.has(operation)) continue;

    const parenIdx = match.index + match[0].length - 1;
    const arg = argBody(scanned, parenIdx);

    const key = `${modelName}.${operation}`;
    const occurrenceIndex = perModelOpIndex.get(key) ?? 0;
    perModelOpIndex.set(key, occurrenceIndex + 1);

    if (hasSpeciesInWhere(arg)) continue;

    let lineNum = 1;
    for (let i = 0; i < lineStarts.length; i++) {
      if (lineStarts[i] > callStart) break;
      lineNum = i + 1;
    }

    if (hasAllowPragma(lines, lineNum - 1)) continue;

    const snippetLine = lines[lineNum - 1]?.trim() ?? '';
    offenders.push({
      path: filePath,
      line: lineNum,
      snippet: snippetLine.slice(0, 160),
      modelName,
      operation,
      occurrenceIndex,
    });
  }

  return offenders;
}

/** Produce the stable baseline key. */
export function offenderKey(o: Offender): string {
  return `${o.path}::${o.modelName}::${o.operation}::${o.occurrenceIndex}`;
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
 * Path prefixes that legitimately span species and must not be scanned.
 * Each entry is a path-relative substring; if any of these appears in
 * the relative file path the file is skipped. Adding to this list is a
 * one-way ratchet — every entry should be justified inline.
 *
 * Order: read-only retrieval first, then write/cron, then explicit
 * roll-ups, then audit/fixtures.
 */
const CROSS_SPECIES_ALLOWLIST_PATHS: string[] = [
  // Farm Einstein RAG ingests every species into the same retrieval index
  // — per-species filtering would defeat the cross-species "ask me about
  // anything on this farm" UX.
  'lib/einstein/',

  // Inngest cron functions iterate farm-wide notifications across every
  // species (e.g. "any animal in withdrawal", "any camp overdue").
  'lib/inngest/',

  // Finance roll-up is farm-wide by definition — SARS IT3 export, P&L,
  // budget vs actual all span species and currency.
  'lib/server/financial-analytics.ts',

  // Cached dashboard data groupBys species — the read must span species
  // so the groupBy() can populate per-species rows in one query. Per-
  // species views downstream consume the bucket they want.
  'lib/server/cached.ts',

  // Multi-farm overview iterates each farm's totals across species.
  'lib/server/multi-farm-overview.ts',

  // Backfill / migration scripts — read every row to write species data;
  // filtering by species defeats the backfill.
  'scripts/backfill-animal-species.ts',
  'scripts/einstein-backfill-embeddings.ts',
  'scripts/audit-schema-parity.ts',

  // The audit script itself + sibling tests + fixtures are full of
  // literal `prisma.<model>.<op>` strings that would self-trigger.
  'scripts/audit-species-where.ts',
  'scripts/__tests__/audit-species-where.test.ts',
  '__tests__/architecture/audit-species-where-fixtures/',
  // The species-scoped facade itself dispatches to the underlying
  // prisma client — those calls inject species themselves and aren't
  // raw unscoped reads.
  'lib/server/species-scoped-prisma.ts',
  'lib/server/__tests__/species-scoped-prisma.test.ts',

  // Sibling audit scripts and tests contain literal `prisma.<model>.<op>`
  // strings as fixture data. They aren't real code paths and would self-
  // trigger the audit. Same approach as `audit-findmany-no-select` skips
  // its own siblings.
  'scripts/audit-findmany-no-select.ts',
  'scripts/audit-findmany-no-take.ts',
  'scripts/__tests__/audit-findmany-no-select.test.ts',
  'scripts/__tests__/audit-findmany-no-take.test.ts',

  // Test files (`*.test.ts` / `*.test.tsx`) — Vitest specs commonly use
  // mocked prisma calls as fixtures. The runtime production-code audit
  // doesn't apply to them. Skipping the whole `__tests__/` tree and any
  // co-located `*.test.ts` mirrors the convention in the sibling audits
  // (`audit-findmany-no-select` doesn't scan its own tests either).
  '__tests__/',
];

/**
 * Per-file suffixes that opt the file out of the audit. We do this in
 * addition to the directory-based allowlist so co-located test files
 * (e.g. `app/api/foo/__tests__/route.test.ts`) are skipped.
 */
const SKIP_FILE_SUFFIXES = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];

function isInAllowlist(relPath: string): boolean {
  const normalised = relPath.split(path.sep).join('/');
  if (SKIP_FILE_SUFFIXES.some((s) => normalised.endsWith(s))) return true;
  return CROSS_SPECIES_ALLOWLIST_PATHS.some((entry) =>
    normalised.includes(entry),
  );
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
   * Set of `path::modelName::operation::occurrenceIndex` keys captured
   * at baseline time. Anything present is silenced; anything not present
   * is a new offender and fails CI. The baseline can only shrink over
   * time, never grow.
   */
  allowlist: string[];
}

const BASELINE_FILE = '.audit-species-where-baseline.json';

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
    // Cheap pre-filter: skip files that don't mention any per-species model.
    let touched = false;
    for (const m of PER_SPECIES_MODELS) {
      if (source.includes(`prisma.${m}.`)) {
        touched = true;
        break;
      }
    }
    if (!touched) continue;
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
      `audit-species-where: wrote baseline with ${keys.length} entries`,
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
        ? `audit-species-where: ${allOffenders.length} offender(s) (--all, baseline ignored)`
        : `audit-species-where: no new offenders${baseline.size ? ` (${baseline.size} grandfathered)` : ''}`,
    );
    process.exit(0);
  }

  for (const o of newOffenders) {
    console.log(`${o.path}:${o.line}  prisma.${o.modelName}.${o.operation} — ${o.snippet}`);
  }
  console.log(
    `\n${newOffenders.length} new offender(s) not covered by ${BASELINE_FILE}`,
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
