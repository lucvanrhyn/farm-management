/**
 * @vitest-environment node
 *
 * __tests__/api/proxy-tenant-gate.test.ts
 *
 * Exercises proxy() directly to lock down cross-tenant access for every
 * first-path-segment subtree under /[farmSlug]/*. A user whose JWT only carries
 * Farm A must be bounced to /farms when they hit any Farm B path, including
 * subtrees that were previously outside the allowlist (onboarding, subscribe,
 * or any future subtree we add).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// getToken is mocked per test case. We return whatever the test sets.
vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(),
}));

import { getToken } from "next-auth/jwt";
import { NextRequest } from "next/server";
import { proxy } from "../../proxy";

const mockedGetToken = vi.mocked(getToken);

function makeRequest(url: string, cookies: Record<string, string> = {}): NextRequest {
  const req = new NextRequest(new URL(url, "https://farmtrack.app"));
  for (const [k, v] of Object.entries(cookies)) {
    req.cookies.set(k, v);
  }
  return req;
}

function tokenForFarms(slugs: string[]) {
  return {
    farms: slugs.map((slug) => ({
      slug,
      tier: "enterprise",
      subscriptionStatus: "active",
    })),
  };
}

beforeEach(() => {
  mockedGetToken.mockReset();
});

describe("proxy tenant gate — every non-reserved first segment is treated as a farm slug", () => {
  const SUBTREES = [
    "admin",
    "dashboard",
    "logger",
    "home",
    "tools",
    "sheep",
    "game",
    // Previously-unreserved subtrees — the P1-A bug
    "onboarding",
    "subscribe",
    // Also future-proof: a hypothetical /[farmSlug]/reports subtree
    "reports",
  ];

  for (const subtree of SUBTREES) {
    it(`redirects /farmB/${subtree} to /farms when session only carries farmA`, async () => {
      mockedGetToken.mockResolvedValue(tokenForFarms(["farmA"]) as never);
      const res = await proxy(makeRequest(`https://farmtrack.app/farmB/${subtree}`));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("https://farmtrack.app/farms");
    });

    it(`lets /farmA/${subtree} through when session carries farmA`, async () => {
      mockedGetToken.mockResolvedValue(tokenForFarms(["farmA"]) as never);
      const res = await proxy(makeRequest(`https://farmtrack.app/farmA/${subtree}`));
      // 200 = NextResponse.next() (may include a Set-Cookie for active_farm_slug).
      // Confirm it's NOT a redirect away.
      expect(res.status).not.toBe(307);
      expect(res.headers.get("location")).not.toBe("https://farmtrack.app/farms");
    });
  }

  it("reserved first segments (/login, /farms, /offline, /verify-email, /subscribe, /register) are NOT treated as farm slugs", async () => {
    mockedGetToken.mockResolvedValue(tokenForFarms(["farmA"]) as never);
    for (const seg of ["login", "farms", "offline", "verify-email", "subscribe", "register"]) {
      const res = await proxy(makeRequest(`https://farmtrack.app/${seg}`));
      expect(
        res.headers.get("location"),
        `/${seg} must not redirect to /farms`,
      ).not.toBe("https://farmtrack.app/farms");
    }
  });

  it("redirects unauthenticated requests to /login regardless of path", async () => {
    mockedGetToken.mockResolvedValue(null as never);
    const res = await proxy(makeRequest("https://farmtrack.app/farmA/admin"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://farmtrack.app/login");
  });

  it("authenticated / redirects to /farms", async () => {
    mockedGetToken.mockResolvedValue(tokenForFarms(["farmA"]) as never);
    const res = await proxy(makeRequest("https://farmtrack.app/"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://farmtrack.app/farms");
  });
});
