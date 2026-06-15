/* @vitest-environment node */
/**
 * __tests__/admin/triage-page.test.tsx — source-level wiring for the Triage
 * page (decision 10b). A full RSC render needs a server runtime jsdom can't
 * unwrap; the established pattern here (see dashboard-page-mode.test.tsx) is a
 * source grep on the page file for the load-bearing wiring contract.
 */
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function pageSrc(): Promise<string> {
  return readFile(
    join(__dirname, "..", "..", "app", "[farmSlug]", "admin", "triage", "page.tsx"),
    "utf-8",
  );
}

describe("Triage page wiring", () => {
  it("calls getTriage with prisma, farmSlug, thresholds and the active mode", async () => {
    const src = await pageSrc();
    expect(src).toMatch(/from\s+["']@\/lib\/server\/triage\/get-triage["']/);
    expect(src).toMatch(/getTriage\(\s*prisma\s*,\s*farmSlug\s*,\s*thresholds\s*,\s*mode\s*\)/);
  });

  it("threads the active-species switcher via getFarmMode", async () => {
    const src = await pageSrc();
    expect(src).toMatch(/from\s+["']@\/lib\/server\/get-farm-mode["']/);
    expect(src).toMatch(/getFarmMode\(\s*farmSlug\s*\)/);
  });

  it("renders TriageClient with the projected items", async () => {
    const src = await pageSrc();
    expect(src).toMatch(/<TriageClient[^>]*items=\{items\}/);
  });

  it("is NOT tier-gated — no basic-tier UpgradePrompt branch", async () => {
    const src = await pageSrc();
    // Triage is the trial-acquisition aha surface (decision 10). It must not
    // short-circuit on tier the way alerts/page.tsx does.
    expect(src).not.toMatch(/UpgradePrompt/);
    expect(src).not.toMatch(/tier\s*===\s*["']basic["']/);
  });

  it("is a force-dynamic server page", async () => {
    const src = await pageSrc();
    expect(src).toMatch(/export const dynamic\s*=\s*["']force-dynamic["']/);
  });
});
