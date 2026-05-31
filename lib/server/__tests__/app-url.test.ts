// @vitest-environment node
/**
 * lib/server/__tests__/app-url.test.ts
 *
 * Locks the single source of truth for the public app base URL
 * (`getAppBaseUrl`, lib/server/app-url.ts). Issue #528 (code half of gate
 * #118, PRD #521 Workstream H).
 *
 * Root cause this guards against: three user-facing link sites
 * (send-email.ts, the two subscribe PayFast pages) used to fall back to the
 * DEAD preview host `https://farm-management-lilac.vercel.app`. The app
 * cut over to `https://app.farmtrack.app` on 2026-05-30 (NEXTAUTH_URL flipped
 * in prod), so the lilac literal is now the WRONG default — a transactional
 * email or PayFast return-URL that fell back to it would point at a dead host.
 *
 * `getAppBaseUrl()` centralises the resolution:
 *   - returns process.env.NEXTAUTH_URL when set (the canonical app-URL env
 *     var already used repo-wide; introducing a NEW var would need a Vercel
 *     infra change, so we deliberately reuse it),
 *   - falls back to the LIVE prod host `https://app.farmtrack.app` when unset
 *     (the safe post-cutover default),
 *   - never returns the dead lilac literal.
 */
import { describe, it, expect, afterEach } from "vitest";
import { getAppBaseUrl } from "../app-url";

const DEAD_LILAC_HOST = "https://farm-management-lilac.vercel.app";
const LIVE_DEFAULT_HOST = "https://app.farmtrack.app";

describe("getAppBaseUrl", () => {
  const original = process.env.NEXTAUTH_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = original;
  });

  it("returns NEXTAUTH_URL when it is set", () => {
    process.env.NEXTAUTH_URL = "https://app.farmtrack.app";
    expect(getAppBaseUrl()).toBe("https://app.farmtrack.app");
  });

  it("returns a caller-supplied NEXTAUTH_URL verbatim (no normalisation)", () => {
    // The helper is a pure env reader — trailing-slash stripping is each call
    // site's concern (the subscribe pages strip; email does not). Keep the
    // helper unopinionated so it can't silently change a caller's URL shape.
    process.env.NEXTAUTH_URL = "https://staging.farmtrack.app/";
    expect(getAppBaseUrl()).toBe("https://staging.farmtrack.app/");
  });

  it("falls back to the LIVE prod host when NEXTAUTH_URL is unset", () => {
    delete process.env.NEXTAUTH_URL;
    expect(getAppBaseUrl()).toBe(LIVE_DEFAULT_HOST);
  });

  it("never returns the dead lilac preview host", () => {
    delete process.env.NEXTAUTH_URL;
    expect(getAppBaseUrl()).not.toContain("farm-management-lilac.vercel.app");
    expect(getAppBaseUrl()).not.toBe(DEAD_LILAC_HOST);
  });
});
