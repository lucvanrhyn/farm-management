#!/usr/bin/env tsx
/**
 * audit-error-envelope
 * ────────────────────
 * Structural lock on the API error contract (issue #493, PRD #479 Epic B).
 * Fails CI on any `app/api/**` route handler that builds a NON-canonical
 * error envelope — specifically an `error:` field whose value is either
 *
 *   (a) a bare string LITERAL or template literal
 *       (`NextResponse.json({ error: "Unauthorized" })`), or
 *   (b) a raw exception message echo (`{ error: err.message }`) — the
 *       info-leak class that can spill internal-schema text to clients.
 *
 * Why this exists
 * ───────────────
 * After the Epic B work (#483 Prisma-throw sanitisation, #485 INVALID_LIMIT,
 * #486 AUTH_REQUIRED fold), every error path is supposed to converge on the
 * typed envelope minted by:
 *
 *   - `routeError(code, message?, status?)` (lib/server/route/envelope.ts)
 *       → `{ error: CODE, message?, details? }`, CODE = SCREAMING_SNAKE.
 *   - `mapApiDomainError(err)` (lib/server/api-errors.ts) — forwards a typed
 *       domain `err.code` / `err.reason` into the same shape.
 *
 * A route that hand-rolls `{ error: "<sentence>" }` re-introduces wire-format
 * drift; a route that echoes `{ error: err.message }` re-introduces the
 * raw-message-leak class (#483). This audit is the *structural* prevention:
 * a new route physically cannot ship either pattern past CI.
 *
 * Compliant patterns
 * ──────────────────
 *   1. Mint via `routeError(...)` — the literal lives in the minter, not the
 *      route, so no `error:` key appears in the route's constructor call.
 *   2. Forward a typed code: `{ error: err.code }`, `{ error: result.reason }`
 *      — a member expression that resolves to a typed string, not a bare
 *      literal and not `.message`.
 *   3. Precede the call with `// audit-allow-error-envelope: <reason>` to
 *      document a deliberate legacy-wire-shape preservation.
 *   4. Be grandfathered in `.audit-error-envelope-baseline.json` (the set of
 *      deliberate bare-string envelopes that predate this lock). The baseline
 *      can only SHRINK — every new offender fails CI.
 *
 * Scope & precision
 * ─────────────────
 * Only `app/api/**` source `.ts`/`.tsx` files are scanned (test files are
 * skipped). Only `error:` keys that appear INSIDE a response constructor are
 * inspected — `NextResponse.json(...)`, `Response.json(...)`, and
 * `new Response(JSON.stringify(...))`. A bare `return { error: "..." }` from
 * an internal validation helper (e.g. a `parseBody` discriminated-union
 * result) is NOT a wire envelope and is never flagged.
 *
 * Baseline key format: `path::kind::occurrenceIndex` — stable under pure
 * line-drift. Mirror of the audit-findmany-* scripts.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Whether the offending `error:` value is a bare literal or a `.message` echo. */
export type OffenderKind = "literal" | "message-echo";

export interface Offender {
  path: string;
  line: number;
  snippet: string;
  kind: OffenderKind;
  occurrenceIndex: number;
}

/**
 * Response-constructor receivers whose first object argument is an on-the-wire
 * body. The matcher anchors `error:` detection to these so internal
 * `return { error: ... }` result objects are never mistaken for envelopes.
 */
const CONSTRUCTOR_RES = [
  // NextResponse.json({ ... }, ...)  /  Response.json({ ... }, ...)
  /(?:NextResponse|Response)\.json\s*\(/g,
  // new Response(JSON.stringify({ ... }), ...)
  /JSON\.stringify\s*\(/g,
];

/**
 * Replace `//` and block comments with whitespace of equal length so the
 * regex scan can't match tokens inside comments. Identical strategy to the
 * audit-findmany-* scripts. String literals are respected.
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
 * Return the balanced-paren argument body starting at the `(` index (the
 * full contents between the matched `(` and its balancing `)`), respecting
 * nested parens, brackets, braces and string literals. Returns "" if the
 * call is unbalanced.
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
 * Classify the value sitting after an `error:` key at brace-depth 1 of a
 * constructor body. `valueStart` points at the first non-space char of the
 * value. Returns the offender kind, or `null` if the value is compliant
 * (a typed code member expression, an identifier, etc.).
 *
 * The classification is deliberately conservative:
 *   - A quoted string (`"..."`, `'...'`) or a template literal (`` `...` ``)
 *     → "literal" (bare ad-hoc envelope).
 *   - A member expression ending in `.message` → "message-echo".
 *   - Anything else (`err.code`, `result.reason`, a bare identifier,
 *     a ternary, a call) → compliant (typed forwarding).
 */
function classifyValue(value: string): OffenderKind | null {
  const v = value.trimStart();
  if (v === "") return null;
  const first = v[0];
  if (first === '"' || first === "'" || first === "`") return "literal";

  // Read the leading member-access expression token (e.g. `err.message`,
  // `e.message`, `result.reason`, `err.code`). Stop at the first char that
  // can't be part of a dotted identifier path.
  let j = 0;
  while (j < v.length && /[A-Za-z0-9_$.]/.test(v[j])) j++;
  const expr = v.slice(0, j);
  // A `.message` access that is the WHOLE leading expression (not a prefix of
  // a longer call like `err.message.slice(...)` — those would have a `(`
  // immediately after, which the dotted-path read excludes). The next
  // significant char after the expression must terminate the value (`,`,
  // `}`, end) for it to be a bare echo rather than a transformed expression.
  if (/\.message$/.test(expr)) {
    const rest = v.slice(j).trimStart();
    if (rest === "" || rest[0] === "," || rest[0] === "}") return "message-echo";
  }
  return null;
}

/**
 * Within a constructor-argument body, find every top-level (brace-depth 1)
 * `error:` key and classify its value. Returns the relative char offsets
 * (within `body`) of each offending `error` key plus its kind.
 */
function findErrorOffenders(
  body: string,
): Array<{ offset: number; kind: OffenderKind }> {
  // Collapse string/template contents to placeholders so a `error:` substring
  // living inside a string can't false-match, while preserving length (so
  // offsets stay aligned with the un-stripped body for value classification).
  const out: Array<{ offset: number; kind: OffenderKind }> = [];
  let depth = 0;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < body.length && body[i] !== quote) {
        if (body[i] === "\\") i += 2;
        else i++;
      }
      i++;
      continue;
    }
    if (ch === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}") {
      depth--;
      i++;
      continue;
    }
    // The body of `NextResponse.json( { ... } )` opens depth 1 at its first
    // `{`. We only care about `error:` keys that are direct members of that
    // top-level object (depth === 1).
    if (depth === 1) {
      const prev = body[i - 1] ?? "";
      const isWordBoundary = !/[A-Za-z0-9_$]/.test(prev);
      if (isWordBoundary && body.startsWith("error", i)) {
        const after = body.slice(i + "error".length);
        const trimmed = after.trimStart();
        if (trimmed.startsWith(":")) {
          const colonRel =
            i + "error".length + (after.length - trimmed.length);
          const value = body.slice(colonRel + 1);
          const kind = classifyValue(value);
          if (kind) out.push({ offset: i, kind });
          // Advance past the key so a value containing the word `error`
          // doesn't re-trigger.
          i = colonRel + 1;
          continue;
        }
      }
    }
    i++;
  }
  return out;
}

/**
 * Check whether the line above the offending call carries an
 * `// audit-allow-error-envelope: <reason>` pragma. Only the directly
 * preceding non-blank line counts.
 */
function hasAllowPragma(lines: string[], lineIdx: number): boolean {
  for (let i = lineIdx - 1; i >= 0; i--) {
    const ln = lines[i].trim();
    if (ln === "") continue;
    return /^\/\/\s*audit-allow-error-envelope\b/.test(ln);
  }
  return false;
}

/**
 * Locate non-canonical error envelopes in `source`. An offender is an
 * `error:` key — inside a response constructor — whose value is a bare
 * literal or a `.message` echo, and which is not silenced by an inline
 * pragma.
 */
export function auditSource(filePath: string, source: string): Offender[] {
  const offenders: Offender[] = [];
  const lines = source.split("\n");
  const scanned = stripComments(source);

  const lineStarts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") lineStarts.push(i + 1);
  }
  function findLine(absOffset: number): number {
    let lineNum = 1;
    for (let i = 0; i < lineStarts.length; i++) {
      if (lineStarts[i] > absOffset) break;
      lineNum = i + 1;
    }
    return lineNum;
  }

  // Collect every (absolute-offset, kind) hit across all constructor calls,
  // then sort by source position so the per-file occurrenceIndex is stable
  // regardless of which constructor regex matched first.
  const hits: Array<{ absOffset: number; kind: OffenderKind }> = [];
  for (const re of CONSTRUCTOR_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(scanned))) {
      const parenIdx = m.index + m[0].length - 1;
      const body = argBody(scanned, parenIdx);
      if (body.indexOf("error") === -1) continue;
      const bodyStart = parenIdx + 1;
      for (const { offset, kind } of findErrorOffenders(body)) {
        hits.push({ absOffset: bodyStart + offset, kind });
      }
    }
  }

  // De-dupe: a `new Response(JSON.stringify({...}))` matches BOTH the
  // `Response.json`-shaped regex (no — `new Response(` isn't `Response.json`)
  // and the `JSON.stringify` regex. In practice the two regexes target
  // disjoint syntaxes, but a defensive de-dup on absolute offset keeps the
  // count correct if they ever overlap.
  const seen = new Set<number>();
  const deduped = hits
    .filter((h) => (seen.has(h.absOffset) ? false : (seen.add(h.absOffset), true)))
    .sort((a, b) => a.absOffset - b.absOffset);

  let occurrenceIndex = 0;
  for (const { absOffset, kind } of deduped) {
    const lineNum = findLine(absOffset);
    if (hasAllowPragma(lines, lineNum - 1)) continue;
    const snippetLine = lines[lineNum - 1]?.trim() ?? "";
    offenders.push({
      path: filePath,
      line: lineNum,
      snippet: snippetLine.slice(0, 160),
      kind,
      occurrenceIndex: occurrenceIndex++,
    });
  }

  return offenders;
}

/** Produce the stable baseline key: `<path>::<kind>::<occurrenceIndex>`. */
export function offenderKey(o: Offender): string {
  return `${o.path}::${o.kind}::${o.occurrenceIndex}`;
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
const SKIP_FILE_SUFFIXES = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];

/** Only `app/api/**` is in scope — that's where wire envelopes live. */
function isInScope(relPath: string): boolean {
  const normalised = relPath.split(path.sep).join("/");
  if (SKIP_FILE_SUFFIXES.some((s) => normalised.endsWith(s))) return false;
  return normalised.startsWith("app/api/");
}

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
      out.push(full);
    }
  }
  return out;
}

interface BaselineFile {
  /**
   * Set of `path::kind::occurrenceIndex` keys captured at baseline time —
   * the deliberate bare-string envelopes that predate this lock. Anything
   * present is silenced; anything absent is a NEW offender and fails CI. The
   * baseline can only shrink.
   */
  allowlist: string[];
}

const BASELINE_FILE = ".audit-error-envelope-baseline.json";

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
    const rel = path.relative(root, file);
    if (!isInScope(rel)) continue;
    const source = await fs.readFile(file, "utf8");
    // Cheap pre-filter — skip files with no error envelope at all.
    if (!source.includes("error")) continue;
    allOffenders.push(...auditSource(rel, source));
  }

  if (writeBaseline) {
    const keys = Array.from(new Set(allOffenders.map(offenderKey))).sort();
    const out: BaselineFile = { allowlist: keys };
    await fs.writeFile(
      path.join(root, BASELINE_FILE),
      JSON.stringify(out, null, 2) + "\n",
      "utf8",
    );
    console.log(
      `audit-error-envelope: wrote baseline with ${keys.length} entries`,
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
        ? `audit-error-envelope: ${allOffenders.length} offender(s) (--all, baseline ignored)`
        : `audit-error-envelope: no new offenders${baseline.size ? ` (${baseline.size} grandfathered)` : ""}`,
    );
    process.exit(0);
  }

  for (const o of newOffenders) {
    console.log(`${o.path}:${o.line}  [${o.kind}]  ${o.snippet}`);
  }
  console.log(
    `\n${newOffenders.length} new offender(s) not covered by ${BASELINE_FILE}`,
  );
  console.log(
    "Mint errors via `routeError(code, message?, status?)` " +
      "(lib/server/route/envelope.ts) or forward a typed domain code through " +
      "`mapApiDomainError` (lib/server/api-errors.ts). Never echo a raw " +
      "`err.message` into the `error` field. If a legacy bare-string envelope " +
      "is a deliberate wire-shape preservation, document it with " +
      "`// audit-allow-error-envelope: <reason>`.",
  );
  process.exit(1);
}

const invokedDirectly = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
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
