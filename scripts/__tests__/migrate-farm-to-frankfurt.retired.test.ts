import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Phase E migration script retirement guard (Wave 1 W1a).
 *
 * The Phase E cutover is COMPLETE — all extant tenants (trio-b-boerdery,
 * ft-basson-boerdery) have been migrated to the Ireland (`dub`) Turso
 * region, and the legacy Tokyo source DBs are scheduled for delete on
 * 2026-05-09. After that date the script's input source ceases to exist.
 *
 * Re-running it would either silently fail or — worse — provision new
 * tenants pointing at non-existent source DBs. The codebase's CLAUDE.md
 * also forbids new hand-rolled `migrate-*.ts` scripts. The audit (W1a)
 * additionally flagged it for missing a write-fence between dump and
 * pointer-swap, which loses any write that lands during that window.
 *
 * Rather than fence dead code, we retire the script. These tests are a
 * tripwire: if anyone ever recreates `migrate-farm-to-frankfurt.ts`
 * without also revisiting this decision, CI will fail loudly.
 */

const __filename = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = join(dirname(__filename), "..");
const REPO_ROOT = join(SCRIPTS_DIR, "..");

describe("Phase E migration script retirement", () => {
  it("scripts/migrate-farm-to-frankfurt.ts no longer exists", () => {
    const path = join(SCRIPTS_DIR, "migrate-farm-to-frankfurt.ts");
    expect(existsSync(path)).toBe(false);
  });

  it("no source file references the retired script by path", () => {
    // Walk repo source files; allow tests + history docs to mention the
    // name (this very test file does), but no live code path should
    // reference `scripts/migrate-farm-to-frankfurt.ts`.
    const offenders: string[] = [];
    const skipDirs = new Set([
      "node_modules",
      ".next",
      ".git",
      ".turbo",
      ".vercel",
      "coverage",
      "bench-results",
      ".worktrees",
      "docs", // docs may reference the historical script name; that's fine
      "__tests__",
    ]);
    const targetExts = [".ts", ".tsx", ".js", ".mjs"];

    function walk(dir: string) {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (ent.name.startsWith(".")) continue;
        const full = join(dir, ent.name);
        if (ent.isDirectory()) {
          if (skipDirs.has(ent.name)) continue;
          walk(full);
          continue;
        }
        if (!targetExts.some((ext) => ent.name.endsWith(ext))) continue;
        // Skip the test file itself
        if (full === __filename) continue;
        const contents = readFileSync(full, "utf8");
        if (contents.includes("scripts/migrate-farm-to-frankfurt")) {
          offenders.push(full);
        }
      }
    }

    walk(REPO_ROOT);
    expect(offenders, `still referenced by:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the runbook records that the script has been retired", () => {
    const runbook = join(REPO_ROOT, "docs/ops/frankfurt-cutover-runbook.md");
    expect(existsSync(runbook)).toBe(true);
    const text = readFileSync(runbook, "utf8").toLowerCase();
    // Must explicitly communicate retirement so a future operator doesn't
    // try to resurrect the script blindly. Match the specific phrase
    // we're committing to, not a generic word that may appear elsewhere.
    expect(text).toMatch(/script (was )?retired|migration script (has been |is )?retired|retired in wave 1/);
  });
});
