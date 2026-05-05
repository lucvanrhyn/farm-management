/**
 * @vitest-environment node
 *
 * P3 fix verification — defense-in-depth response headers.
 *
 * These tests pin the *contract* (every header is present, names + values
 * match the agreed set, CSP allowlist is exactly what we approved) so a
 * future "let me just add 'unsafe-inline' real quick" change shows up in
 * code review.
 *
 * The CSP itself ships as report-only for the first 2 weeks — see TODO
 * inside `lib/security/csp.ts` for the enforcement-flip date.
 */

import { describe, it, expect } from "vitest";
import { buildCsp, buildSecurityHeaders } from "@/lib/security/csp";

describe("buildSecurityHeaders", () => {
  const headers = buildSecurityHeaders();
  const map = new Map(headers.map((h) => [h.key, h.value]));

  it("includes HSTS with 2-year max-age, includeSubDomains, preload", () => {
    expect(map.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
  });

  it("denies framing via X-Frame-Options", () => {
    expect(map.get("X-Frame-Options")).toBe("DENY");
  });

  it("blocks MIME sniffing", () => {
    expect(map.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("uses strict-origin-when-cross-origin Referrer-Policy", () => {
    expect(map.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("locks down Permissions-Policy: camera+geolocation self only, mic disabled", () => {
    expect(map.get("Permissions-Policy")).toBe(
      "camera=(self), microphone=(), geolocation=(self)",
    );
  });

  it("ships CSP as Report-Only during soak, not enforcement", () => {
    expect(map.has("Content-Security-Policy-Report-Only")).toBe(true);
    expect(map.has("Content-Security-Policy")).toBe(false);
  });

  it("emits exactly the seven expected headers (no surprise additions)", () => {
    // Wave 4 A8 (2026-05-02): added `Reporting-Endpoints` so the CSP
    // report-only soak actually collects telemetry. Detailed contract
    // for the new header lives in `csp-report.test.ts`.
    const keys = headers.map((h) => h.key).sort();
    expect(keys).toEqual(
      [
        "Content-Security-Policy-Report-Only",
        "Permissions-Policy",
        "Referrer-Policy",
        "Reporting-Endpoints",
        "Strict-Transport-Security",
        "X-Content-Type-Options",
        "X-Frame-Options",
      ].sort(),
    );
  });
});

describe("buildCsp", () => {
  const csp = buildCsp();
  // Parse the CSP string into a directive map so individual asserts are
  // readable. Trailing/empty directive strings (upgrade-insecure-requests)
  // produce an empty source list — that's by design.
  const directives = new Map<string, string[]>(
    csp
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...sources] = d.split(/\s+/);
        return [name, sources];
      }),
  );

  it("default-src is 'self' only", () => {
    expect(directives.get("default-src")).toEqual(["'self'"]);
  });

  it("frame-ancestors 'none' (CSP3 clickjacking control)", () => {
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("object-src 'none' (block legacy plugin embeds)", () => {
    expect(directives.get("object-src")).toEqual(["'none'"]);
  });

  it("base-uri 'self' (block <base> tag injection)", () => {
    expect(directives.get("base-uri")).toEqual(["'self'"]);
  });

  it("upgrades insecure requests", () => {
    expect(directives.has("upgrade-insecure-requests")).toBe(true);
  });

  it("allows the three Mapbox endpoints in img-src + connect-src", () => {
    const img = directives.get("img-src") ?? [];
    const connect = directives.get("connect-src") ?? [];
    for (const src of [
      "https://api.mapbox.com",
      "https://events.mapbox.com",
      "https://*.tiles.mapbox.com",
    ]) {
      expect(img).toContain(src);
      expect(connect).toContain(src);
    }
  });

  it("allows Open-Meteo forecast API in connect-src (browser WeatherWidget fetch)", () => {
    // P0 (2026-05-04): components/dashboard/WeatherWidget.tsx is a "use client"
    // component that fetches https://api.open-meteo.com/v1/forecast directly
    // from the browser. Without this entry, the 2026-05-11 enforce-mode flip
    // (Content-Security-Policy-Report-Only → Content-Security-Policy) blocks
    // every weather fetch on every admin page. archive-api.open-meteo.com is
    // server-only (lib/server/open-meteo.ts) and stays out of CSP.
    const connect = directives.get("connect-src") ?? [];
    expect(connect).toContain("https://api.open-meteo.com");
  });

  it("allows Google Fonts in style-src + font-src (next/font/google)", () => {
    expect(directives.get("style-src")).toContain(
      "https://fonts.googleapis.com",
    );
    expect(directives.get("font-src")).toContain("https://fonts.gstatic.com");
  });

  it("allows Vercel Blob in img-src for uploaded photos", () => {
    expect(directives.get("img-src")).toContain(
      "https://*.public.blob.vercel-storage.com",
    );
  });

  it("permits data: + blob: in img-src for in-app photo previews", () => {
    const img = directives.get("img-src") ?? [];
    expect(img).toContain("data:");
    expect(img).toContain("blob:");
  });

  it("allows worker blob: URLs (Serwist precache + mapbox-gl worker)", () => {
    const worker = directives.get("worker-src") ?? [];
    expect(worker).toContain("'self'");
    expect(worker).toContain("blob:");
  });

  it("form-action allows PayFast checkout (live + sandbox)", () => {
    const formAction = directives.get("form-action") ?? [];
    expect(formAction).toContain("'self'");
    expect(formAction).toContain("https://www.payfast.co.za");
    expect(formAction).toContain("https://sandbox.payfast.co.za");
  });

  it("does NOT silently allow arbitrary https: in script-src", () => {
    const script = directives.get("script-src") ?? [];
    expect(script).not.toContain("https:");
    expect(script).not.toContain("*");
  });
});
