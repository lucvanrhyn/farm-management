import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * /register and /verify-email must also live under the `(auth)` route
 * group. Same rationale as /login: they don't need the app shell and
 * shouldn't inflate the first-load JS.
 */

const repoRoot = path.resolve(__dirname, "..", "..");

describe("/register lives under the (auth) route group", () => {
  it("has page.tsx at app/(auth)/register/page.tsx", () => {
    const groupPath = path.join(
      repoRoot,
      "app",
      "(auth)",
      "register",
      "page.tsx",
    );
    expect(existsSync(groupPath)).toBe(true);
  });

  it("no longer exists at the old top-level app/register/page.tsx", () => {
    const oldPath = path.join(repoRoot, "app", "register", "page.tsx");
    expect(existsSync(oldPath)).toBe(false);
  });
});

describe("/verify-email lives under the (auth) route group", () => {
  it("has page.tsx at app/(auth)/verify-email/page.tsx", () => {
    const groupPath = path.join(
      repoRoot,
      "app",
      "(auth)",
      "verify-email",
      "page.tsx",
    );
    expect(existsSync(groupPath)).toBe(true);
  });

  it("no longer exists at the old top-level app/verify-email/page.tsx", () => {
    const oldPath = path.join(repoRoot, "app", "verify-email", "page.tsx");
    expect(existsSync(oldPath)).toBe(false);
  });
});
