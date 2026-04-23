/**
 * __tests__/lib/flags.test.ts
 *
 * Verifies the per-slug cache feature flag logic.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isCacheEnabled, __resetFlagCache } from "@/lib/flags";

beforeEach(() => {
  __resetFlagCache();
});

afterEach(() => {
  delete process.env.FARM_CACHE_ENABLED_SLUGS;
  __resetFlagCache();
});

describe("isCacheEnabled", () => {
  it("returns false when env var is not set", () => {
    expect(isCacheEnabled("trio-b")).toBe(false);
    expect(isCacheEnabled("basson")).toBe(false);
  });

  it("returns false when env var is empty string", () => {
    process.env.FARM_CACHE_ENABLED_SLUGS = "";
    __resetFlagCache();
    expect(isCacheEnabled("trio-b")).toBe(false);
  });

  it("returns true for all slugs when set to '*'", () => {
    process.env.FARM_CACHE_ENABLED_SLUGS = "*";
    __resetFlagCache();
    expect(isCacheEnabled("trio-b")).toBe(true);
    expect(isCacheEnabled("basson")).toBe(true);
    expect(isCacheEnabled("some-new-farm")).toBe(true);
  });

  it("returns true only for listed slugs in comma-separated allowlist", () => {
    process.env.FARM_CACHE_ENABLED_SLUGS = "trio-b,basson";
    __resetFlagCache();
    expect(isCacheEnabled("trio-b")).toBe(true);
    expect(isCacheEnabled("basson")).toBe(true);
    expect(isCacheEnabled("other-farm")).toBe(false);
  });

  it("trims whitespace from slug entries", () => {
    process.env.FARM_CACHE_ENABLED_SLUGS = "  trio-b , basson  ";
    __resetFlagCache();
    expect(isCacheEnabled("trio-b")).toBe(true);
    expect(isCacheEnabled("basson")).toBe(true);
  });

  it("is case-sensitive — 'Trio-B' does not match 'trio-b'", () => {
    process.env.FARM_CACHE_ENABLED_SLUGS = "trio-b";
    __resetFlagCache();
    expect(isCacheEnabled("Trio-B")).toBe(false);
  });

  it("memoises the parse result (stable across repeated calls)", () => {
    process.env.FARM_CACHE_ENABLED_SLUGS = "trio-b";
    __resetFlagCache();
    expect(isCacheEnabled("trio-b")).toBe(true);
    // Second call hits memo — value is still true
    expect(isCacheEnabled("trio-b")).toBe(true);
  });
});
