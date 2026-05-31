// @vitest-environment node
/**
 * scripts/__tests__/audit-preview-hostname.test.ts
 *
 * Unit tests for the dead-preview-host grep guard (issue #528, code half of
 * gate #118). The guard scans `app/` + `lib/` source for any NEW occurrence
 * of the dead preview host `farm-management-lilac.vercel.app` in real
 * (non-comment) code and fails CI if one appears.
 *
 * Root cause it locks: three user-facing link sites used to fall back to that
 * host. The app cut over to `https://app.farmtrack.app` on 2026-05-30, so the
 * literal is now a regression magnet — a future copy-paste of the old
 * `NEXTAUTH_URL ?? 'https://farm-management-lilac.vercel.app'` shape would
 * silently point a farmer at a dead host. The guard is the structural lock;
 * `getAppBaseUrl()` is the single source of truth it backstops.
 *
 * The guard intentionally IGNORES the literal inside `//` and block comments
 * so the historical doc-comment in lib/security/csp.ts (which references the
 * old preview deploy by name, not as a link) does not false-positive.
 */
import { describe, it, expect } from "vitest";
import { auditSource, DEAD_PREVIEW_HOST } from "../audit-preview-hostname";

describe("auditSource — dead preview host literal", () => {
  it("flags a new lilac literal used as a real string in code", () => {
    const source = `const appUrl = process.env.NEXTAUTH_URL ?? 'https://farm-management-lilac.vercel.app';`;
    const offenders = auditSource("app/some/page.tsx", source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].line).toBe(1);
    expect(offenders[0].snippet).toContain(DEAD_PREVIEW_HOST);
  });

  it("flags the literal inside a double-quoted string too", () => {
    const source = `return process.env.NEXTAUTH_URL ?? "https://farm-management-lilac.vercel.app";`;
    expect(auditSource("lib/server/x.ts", source)).toHaveLength(1);
  });

  it("flags each occurrence on its own line", () => {
    const source = [
      `const a = 'https://farm-management-lilac.vercel.app/foo';`,
      `const ok = 'https://app.farmtrack.app';`,
      `const b = 'https://farm-management-lilac.vercel.app/bar';`,
    ].join("\n");
    const offenders = auditSource("app/multi.tsx", source);
    expect(offenders.map((o) => o.line).sort((x, y) => x - y)).toEqual([1, 3]);
  });

  it("does NOT flag the literal inside a // line comment (csp.ts doc-comment class)", () => {
    const source = [
      `// P3 from the 2026-04-27 stress-test of farm-management-lilac.vercel.app:`,
      `const appUrl = getAppBaseUrl();`,
    ].join("\n");
    expect(auditSource("lib/security/csp.ts", source)).toEqual([]);
  });

  it("does NOT flag the literal inside a /* ... */ block comment", () => {
    const source = [
      `/**`,
      ` * Historical: deploy was farm-management-lilac.vercel.app before cutover.`,
      ` */`,
      `export function getAppBaseUrl() { return process.env.NEXTAUTH_URL ?? 'https://app.farmtrack.app'; }`,
    ].join("\n");
    expect(auditSource("lib/server/app-url.ts", source)).toEqual([]);
  });

  it("passes clean for source that uses the canonical app host", () => {
    const source = `const appUrl = getAppBaseUrl().replace(/\\/$/, '');`;
    expect(auditSource("app/subscribe/page.tsx", source)).toEqual([]);
  });

  it("does not match an unrelated vercel.app host", () => {
    const source = `const other = 'https://some-other-app.vercel.app';`;
    expect(auditSource("lib/x.ts", source)).toEqual([]);
  });
});

describe("DEAD_PREVIEW_HOST", () => {
  it("is the dead preview host string the guard hunts for", () => {
    expect(DEAD_PREVIEW_HOST).toBe("farm-management-lilac.vercel.app");
  });
});
