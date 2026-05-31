#!/usr/bin/env tsx
/**
 * audit-external-as-cast
 * ──────────────────────
 * Static guard against the #525 bug class: an unchecked `as <ConcreteType>`
 * assertion applied to the deserialized body of a THIRD-PARTY HTTP API — a
 * `.json()` call or `JSON.parse(...)` — instead of routing it through a zod
 * boundary door. That cast lets a provider format change degrade SILENTLY: the
 * Open-Meteo `precipitation_sum` drift used to coerce to all-zero rainfall and
 * corrupt the SPI / drought math (`lib/server/drought.ts`). The fix is the
 * door (`lib/server/adapters/openmeteo-door.ts`) returning a typed `Result`.
 *
 * Why the scope is deliberately NARROW
 * ────────────────────────────────────
 * A blanket "no `.json() as T` anywhere" guard false-positives on ~100
 * legitimate internal casts: our OWN request bodies (`req.json() as Body`,
 * validated downstream), our OWN API responses (we control the shape), and
 * `JSON.parse` of strings WE persisted (sessionStorage, DB `details` columns).
 * None of those are the #525 class. The distinguishing signal is that the body
 * comes from an EXTERNAL provider whose schema we don't control.
 *
 * An OFFENDER therefore requires BOTH:
 *   1. the file is an "external-API boundary" — it `fetch`es a known external
 *      provider host (see {@link EXTERNAL_PROVIDER_HOSTS}); AND
 *   2. a `.json()` / `JSON.parse(...)` result is `as`-cast to a CONCRETE type
 *      (anything other than `unknown` / `Promise<unknown>`). Casting to
 *      `unknown` is the SAFE door-feeding pattern (`res.json() as
 *      Promise<unknown>` → `parseOpenMeteoForecast(raw)`) and is allowed.
 *
 * NOT offenders (must stay green):
 *   - `x as const`; internal-value casts (`el as HTMLInputElement`).
 *   - a `.json()` / `JSON.parse` cast in a file that hits NO external provider
 *     (our own routes, sessionStorage caches, DB-`details` parses).
 *   - a boundary read cast to `unknown` / `Promise<unknown>` (the door shape).
 *   - anything carrying `// audit-allow-external-cast: <reason>` on the
 *     preceding non-blank line (a deliberate cast into a third-party SDK that
 *     validates the body itself).
 *
 * Extensibility: a NEW external door (e.g. the OpenAI adapter, #524) adds its
 * provider host to {@link EXTERNAL_PROVIDER_HOSTS} so the guard locks that
 * boundary too. Comment / string handling + the line-number mapping are lifted
 * verbatim from `audit-findmany-no-select.ts` (the proven shape).
 *
 * The analyser (`auditSource`) is exported for unit tests; the CLI portion only
 * runs when the file is invoked directly.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface Offender {
  path: string;
  line: number;
  snippet: string;
}

/**
 * Hosts of the third-party HTTP APIs whose `.json()` bodies must go through a
 * door, not an `as` cast. A file that `fetch`es one of these is treated as an
 * external-API boundary by the CLI. Add a host here when you add an external
 * adapter door.
 */
export const EXTERNAL_PROVIDER_HOSTS: readonly string[] = [
  "open-meteo.com",
  "archive-api.open-meteo.com",
  "api.open-meteo.com",
];

/**
 * Match `… .json()  as  <Type>` or `JSON.parse( … )  as  <Type>` where `<Type>`
 * is CONCRETE — i.e. NOT `const`, NOT `unknown`, NOT `Promise<unknown>`.
 *
 *   - boundary token: `\.json\s*\(\s*\)` (no-arg `.json()`) OR
 *     `JSON\.parse\s*\([^)]*\)` (single-level args — the boundary reads pass one).
 *   - then optional close-parens / whitespace, the `as` keyword, and a type
 *     start char that is NOT `const`/`unknown`. A named type (`Foo`,
 *     `Promise<Foo>`) or an inline object/tuple type (`{ … }`, `[ … ]`) both
 *     count; casting to `unknown` / `Promise<unknown>` is the safe
 *     door-feeding shape and is allowed.
 */
const BOUNDARY_CAST_RE =
  /(?:\.json\s*\(\s*\)|JSON\.parse\s*\([^)]*\))[\s)]*\bas\s+(?!const\b)(?!unknown\b)(?!Promise\s*<\s*unknown\s*>)[A-Za-z_${[]/g;

/**
 * Replace every `//` line comment and `/* … *\/` block comment with spaces of
 * equal length (newlines preserved), so the regex can't match a cast that only
 * appears in a comment. String literals are respected. Lifted from
 * `audit-findmany-no-select.ts`.
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
 * True when the immediately-preceding non-blank line carries an
 * `// audit-allow-external-cast` pragma. Scoped to the single line above so one
 * pragma can't silence unrelated casts lower in the file.
 */
function hasAllowPragma(lines: string[], lineIdx: number): boolean {
  for (let i = lineIdx - 1; i >= 0; i--) {
    const ln = lines[i].trim();
    if (ln === "") continue;
    return /^\/\/\s*audit-allow-external-cast\b/.test(ln);
  }
  return false;
}

/**
 * True when `source` `fetch`es one of the known external provider hosts — i.e.
 * the file is an external-API boundary whose `.json()` casts this guard polices.
 * Comment-stripped so a host that only appears in a doc-comment doesn't count.
 */
export function isExternalBoundaryFile(source: string): boolean {
  const scanned = stripComments(source);
  if (!/\bfetch\s*\(/.test(scanned)) return false;
  return EXTERNAL_PROVIDER_HOSTS.some((host) => scanned.includes(host));
}

/**
 * Locate external-boundary `as` casts in `source`.
 *
 * @param isExternalBoundary  whether the file is an external-API boundary. The
 *   CLI computes this via {@link isExternalBoundaryFile}; unit tests pass it
 *   explicitly to drive both the boundary and non-boundary branches. Defaults
 *   to `true` so a bare `auditSource(path, src)` checks the cast shape itself.
 */
export function auditSource(
  filePath: string,
  source: string,
  isExternalBoundary = true,
): Offender[] {
  if (!isExternalBoundary) return [];

  const offenders: Offender[] = [];
  const lines = source.split("\n");
  const scanned = stripComments(source);

  const lineStarts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") lineStarts.push(i + 1);
  }

  BOUNDARY_CAST_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BOUNDARY_CAST_RE.exec(scanned))) {
    const idx = match.index;

    let lineNum = 1;
    for (let i = 0; i < lineStarts.length; i++) {
      if (lineStarts[i] > idx) break;
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

/** Stable baseline key for an offender: `<path>::<line>`. */
export function offenderKey(o: Offender): string {
  return `${o.path}::${o.line}`;
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
      // Skip the guard itself and its unit test — both are intentionally full
      // of boundary-cast example strings + provider hosts that would otherwise
      // self-trigger.
      if (full.endsWith("/audit-external-as-cast.ts")) continue;
      if (full.endsWith("/audit-external-as-cast.test.ts")) continue;
      out.push(full);
    }
  }
  return out;
}

async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const rootArg = args.find((a) => !a.startsWith("--"));
  const root = rootArg ? path.resolve(rootArg) : DEFAULT_ROOT;
  const files = await collectFiles(root);

  const allOffenders: Offender[] = [];
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    // Cheap pre-filter: a boundary cast needs a `.json()`/`JSON.parse` token,
    // an `as ` keyword, and the file must hit an external provider.
    if (!source.includes(".json(") && !source.includes("JSON.parse(")) continue;
    if (!source.includes(" as ")) continue;
    if (!isExternalBoundaryFile(source)) continue;
    const rel = path.relative(root, file);
    allOffenders.push(...auditSource(rel, source, true));
  }

  if (allOffenders.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      "audit-external-as-cast: no unchecked external-provider boundary casts",
    );
    process.exit(0);
  }

  for (const o of allOffenders) {
    // eslint-disable-next-line no-console
    console.log(`${o.path}:${o.line}  ${o.snippet}`);
  }
  // eslint-disable-next-line no-console
  console.log(
    `\n${allOffenders.length} unchecked external-provider boundary as-cast(s). ` +
      `Route the .json()/JSON.parse body through a zod door (see ` +
      `lib/server/adapters/openmeteo-door.ts, #525) or annotate with ` +
      `// audit-allow-external-cast: <reason>.`,
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
