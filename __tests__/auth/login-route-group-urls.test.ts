import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * /login must be served from the `(auth)` route group so it inherits a
 * minimal app shell (no OfflineProvider, no SessionProvider, no
 * service-worker bootstrap). Route groups — parens in the folder name —
 * are stripped by Next from the URL, so `/login` keeps working.
 *
 * This test pins the filesystem contract: the page lives at
 * `app/(auth)/login/page.tsx`, NOT `app/login/page.tsx`.
 * It also pins the proxy.ts auth-route allowlist so unauthenticated
 * visits to `/login` aren't redirected back to `/login` in a loop.
 */

const repoRoot = path.resolve(__dirname, "..", "..");

describe("/login lives under the (auth) route group", () => {
  it("has page.tsx at app/(auth)/login/page.tsx", () => {
    const groupPath = path.join(repoRoot, "app", "(auth)", "login", "page.tsx");
    expect(existsSync(groupPath)).toBe(true);
  });

  it("no longer exists at the old top-level app/login/page.tsx", () => {
    const oldPath = path.join(repoRoot, "app", "login", "page.tsx");
    expect(existsSync(oldPath)).toBe(false);
  });

  it("exposes a minimal layout at app/(auth)/layout.tsx (no SessionProvider / SWRegistrar)", async () => {
    const layoutPath = path.join(repoRoot, "app", "(auth)", "layout.tsx");
    expect(existsSync(layoutPath)).toBe(true);
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(layoutPath, "utf8");
    // Budget-critical: these heavy providers MUST NOT be imported into the
    // auth-route shell. If one sneaks back in the /login bundle balloons
    // past the 100 KB brotli budget enforced by scripts/audit-bundle.ts.
    expect(src).not.toMatch(/SWRegistrar/);
    expect(src).not.toMatch(/OfflineProvider/);
    expect(src).not.toMatch(/FarmModeProvider/);
    expect(src).not.toMatch(/NotificationBell/);
    expect(src).not.toMatch(/SessionProvider/);
    expect(src).not.toMatch(/from ["']\.\.\/providers["']/);
  });
});

describe("proxy.ts matcher still treats /login as a public auth path", () => {
  it("the negative-lookahead matcher in proxy.ts excludes 'login'", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(path.join(repoRoot, "proxy.ts"), "utf8");
    // The matcher uses a negative lookahead like `(?!login|register|...)`.
    // Route groups don't change URL paths, so the *string* `login` must
    // still be listed. If this assertion fails after the move, the
    // middleware will try to redirect unauthenticated users to /login
    // while they are *on* /login → infinite loop.
    expect(src).toMatch(/\(\?!login\|register\|verify-email/);
  });
});
