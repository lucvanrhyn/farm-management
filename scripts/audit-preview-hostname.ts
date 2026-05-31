#!/usr/bin/env tsx
/**
 * audit-preview-hostname
 * ──────────────────────
 * Static grep-guard: fails CI if the DEAD preview host
 * `farm-management-lilac.vercel.app` appears as a real (non-comment) literal
 * anywhere under `app/` or `lib/`.
 *
 * Why this exists
 * ───────────────
 * Issue #528 (code half of gate #118, PRD #521 Workstream H). Three
 * user-facing link sites — `lib/server/send-email.ts` and the two subscribe
 * PayFast pages — used to fall back to that host:
 *
 *     process.env.NEXTAUTH_URL ?? 'https://farm-management-lilac.vercel.app'
 *
 * The app cut over to `https://app.farmtrack.app` on 2026-05-30 (NEXTAUTH_URL
 * flipped in prod, DNS + auth live), so the lilac deploy is DEAD. A
 * transactional email or PayFast return-URL that fell back to it would point a
 * farmer at a host that no longer serves the app. The call sites now resolve
 * through `getAppBaseUrl()` (lib/server/app-url.ts); this guard is the
 * structural lock that stops the dead literal from creeping back in via a
 * copy-paste of the old shape.
 *
 * Comments are exempt
 * ───────────────────
 * The literal legitimately survives in ONE doc-comment — `lib/security/csp.ts`
 * references the old preview deploy by name when explaining why the security-
 * header file exists. That's documentation, not a link, so the guard strips
 * `//` and block comments before scanning. Any NEW comment mentioning the host
 * is therefore also tolerated; only real string/code literals fail the gate.
 *
 * The analyser (`auditSource`) is exported for unit tests; the CLI portion
 * below only runs when the file is invoked directly. Re-exported from
 * `scripts/audit-bundle.ts` so it joins the audit-script module surface.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The dead preview host this guard hunts for. */
export const DEAD_PREVIEW_HOST = "farm-management-lilac.vercel.app";

export interface Offender {
  path: string;
  line: number;
  snippet: string;
}

/**
 * Replace every `//` line comment and block comment in `src` with spaces of
 * equal length, preserving newlines (and therefore the line-number mapping).
 * String literals are respected so a host inside a string still scans as code.
 * Lifted from `audit-findmany-no-select.ts` — same proven shape.
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
 * Return offenders: every line of `source` where the dead preview host
 * appears as a real (non-comment) literal. The character-index → line-number
 * mapping is preserved by `stripComments`, so we report against the original
 * line for a readable snippet.
 */
export function auditSource(filePath: string, source: string): Offender[] {
  const scanned = stripComments(source);
  const offenders: Offender[] = [];

  let from = 0;
  for (;;) {
    const idx = scanned.indexOf(DEAD_PREVIEW_HOST, from);
    if (idx === -1) break;
    from = idx + DEAD_PREVIEW_HOST.length;

    // index → 1-based line number
    let line = 1;
    for (let i = 0; i < idx; i++) {
      if (source[i] === "\n") line++;
    }
    const lines = source.split("\n");
    const snippet = (lines[line - 1] ?? "").trim().slice(0, 160);
    offenders.push({ path: filePath, line, snippet });
  }

  return offenders;
}

// ─── CLI entry-point ────────────────────────────────────────────

const DEFAULT_ROOT = path.resolve(process.cwd());
// Only user-facing link code lives under these roots. CLI doc-comments in
// `scripts/*` (post-promote-smoke.ts, bench-prod-cold.ts) reference the old
// host as an example invocation and are intentionally out of scope.
const SCAN_ROOTS = ["app", "lib"];
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
  "__tests__",
]);

async function collectFiles(root: string, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return out; // root doesn't exist in this checkout — skip silently
  }
  for (const entry of entries) {
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

async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const rootArg = args.find((a) => !a.startsWith("--"));
  const root = rootArg ? path.resolve(rootArg) : DEFAULT_ROOT;

  const files: string[] = [];
  for (const scanRoot of SCAN_ROOTS) {
    await collectFiles(path.join(root, scanRoot), files);
  }

  const offenders: Offender[] = [];
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    if (!source.includes(DEAD_PREVIEW_HOST)) continue;
    const rel = path.relative(root, file);
    offenders.push(...auditSource(rel, source));
  }

  if (offenders.length === 0) {
    console.log(
      `audit-preview-hostname: no '${DEAD_PREVIEW_HOST}' literals in app/ or lib/ code`,
    );
    process.exit(0);
  }

  for (const o of offenders) {
    console.error(`${o.path}:${o.line}  ${o.snippet}`);
  }
  console.error(
    `\n${offenders.length} occurrence(s) of the dead preview host '${DEAD_PREVIEW_HOST}' in app/ or lib/ code.\n` +
      `That deploy is DEAD post-cutover (2026-05-30). Use getAppBaseUrl() from lib/server/app-url.ts instead.`,
  );
  process.exit(1);
}

// Only run the CLI when invoked directly. Vitest imports this module
// in-process and must NOT trigger the scan.
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
