/**
 * @vitest-environment node
 *
 * Workstream F (#113) — silent-failure guard.
 *
 * PRD #521, user story 22: "As a maintainer, I want a lint rule that blocks
 * *new* truly-empty catch blocks, so that silent error-swallowing cannot be
 * introduced going forward."
 *
 * This is the structural regression test for that guard. It does NOT scan the
 * source tree (the repo already has zero bare catches — `pnpm lint` proves
 * that on every run). Instead it loads the repo's ACTUAL flat config
 * (`eslint.config.mjs`) through ESLint's programmatic API and lints two tiny
 * fixture strings, asserting the wiring end-to-end:
 *
 *   1. A truly-bare `catch {}` → MUST raise a `no-empty` error. This is the
 *      behaviour the guard exists to enforce; if someone deletes the rule
 *      override, this assertion goes red.
 *
 *   2. A `catch { // intentional }` (comment-only body) → MUST stay legal.
 *      ESLint's `no-empty` treats a block containing a comment as non-empty by
 *      design, so the ~56 already-commented intentional catches in the tree
 *      remain valid. This pins the "leave intentional catches alone" half of
 *      the contract — the whole reason the guard is safe to land at $0 churn.
 *
 * Mirrors the lightweight, no-network, node-env style of
 * `__tests__/api/route-handler-coverage.test.ts`.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ESLint } from "eslint";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const CONFIG_FILE = join(REPO_ROOT, "eslint.config.mjs");

/** Lint a TS source string against the repo's real flat config. */
async function lintSource(eslint: ESLint, code: string) {
  // `.ts` so the typescript parser/config applies; filePath only affects which
  // config entries match (none of our overrides are path-scoped beyond the
  // global ignores, which a synthetic in-repo path does not hit).
  return eslint.lintText(code, { filePath: join(REPO_ROOT, "__fixture__.ts") });
}

const BARE_CATCH = `
export function risky() {
  try {
    JSON.parse("{}");
  } catch {}
}
`;

const COMMENTED_CATCH = `
export function intentional() {
  try {
    JSON.parse("{}");
  } catch {
    // intentional: best-effort parse, nothing to recover.
  }
}
`;

describe("no-empty catch guard (#113)", () => {
  let eslint: ESLint;

  beforeAll(() => {
    eslint = new ESLint({ overrideConfigFile: CONFIG_FILE });
  });

  it("flags a truly-bare catch block as a `no-empty` error", async () => {
    const [result] = await lintSource(eslint, BARE_CATCH);
    const noEmpty = result.messages.filter((m) => m.ruleId === "no-empty");
    expect(
      noEmpty.length,
      `Expected the bare \`catch {}\` to raise a no-empty error.\n` +
        `Messages: ${JSON.stringify(result.messages, null, 2)}`,
    ).toBeGreaterThan(0);
    // It must be an error (severity 2), not a downgraded warning.
    expect(noEmpty.every((m) => m.severity === 2)).toBe(true);
  });

  it("leaves a comment-only catch block legal (intentional catches stay)", async () => {
    const [result] = await lintSource(eslint, COMMENTED_CATCH);
    const noEmpty = result.messages.filter((m) => m.ruleId === "no-empty");
    expect(
      noEmpty,
      `A commented catch must NOT trip no-empty (allowEmptyCatch design):\n` +
        `${JSON.stringify(result.messages, null, 2)}`,
    ).toEqual([]);
  });

  it("resolves `no-empty` to error with allowEmptyCatch disabled in the real config", async () => {
    const config = await eslint.calculateConfigForFile(
      join(REPO_ROOT, "__fixture__.ts"),
    );
    expect(config.rules?.["no-empty"]).toBeDefined();
    const [severity, options] = config.rules!["no-empty"] as [
      number | string,
      { allowEmptyCatch?: boolean },
    ];
    // Normalized severity is the number 2 ("error").
    expect(severity).toBe(2);
    expect(options?.allowEmptyCatch).toBe(false);
  });
});
