/**
 * __tests__/api/export-type-guard.test.ts
 *
 * Regression test for M1 (round-2 adversarial review):
 *   `isExportType` must reject inherited Object.prototype keys so that
 *   hostile query params like `?type=__proto__` return a controlled 400,
 *   not an uncaught 500.
 *
 * TDD RED phase: written BEFORE the production fix. The hostile-key
 * cases should FAIL (isExportType returns true for inherited keys with
 * the buggy `value in EXPORTERS` implementation) demonstrating the
 * bug is real. After the fix (`Object.hasOwn`) all cases should be green.
 *
 * Test strategy: unit-test `isExportType` directly. This is sufficient
 * because the route's 400 guard is a single `if (!isExportType(typeParam))`
 * call — fixing the type guard is the root-cause fix, and the public
 * function is the correct testing surface.
 */
import { describe, it, expect } from "vitest";
import { isExportType } from "@/lib/server/export";

// ── Inherited / hostile keys ──────────────────────────────────────────────────
// These are keys that exist on Object.prototype. The buggy `value in EXPORTERS`
// returns true for all of them because `in` traverses the prototype chain.
// A correct guard must return false for every one of them.
const HOSTILE_KEYS = [
  "__proto__",
  "constructor",
  "hasOwnProperty",
  "toString",
  "valueOf",
] as const;

describe("isExportType — hostile Object.prototype keys", () => {
  it.each(HOSTILE_KEYS)(
    "rejects '%s' as an export type (must return false, not true)",
    (key) => {
      // With the buggy `value in EXPORTERS`, this will return true → test FAILS (RED).
      // After the fix with `Object.hasOwn`, this will return false → test PASSES (GREEN).
      expect(isExportType(key)).toBe(false);
    },
  );
});

// ── Valid registered exporters ────────────────────────────────────────────────
// Confirms the guard still accepts real export types after the fix.
const VALID_TYPES = [
  "animals",
  "calvings",
  "camps",
  "transactions",
  "weight-history",
  "withdrawal",
  "reproduction",
  "performance",
  "rotation-plan",
  "cost-of-gain",
  "veld-score",
  "feed-on-offer",
  "drought",
  "sars-it3",
] as const;

describe("isExportType — valid registered exporters", () => {
  it.each(VALID_TYPES)(
    "accepts '%s' as a valid export type",
    (type) => {
      expect(isExportType(type)).toBe(true);
    },
  );
});

// ── Truly invalid strings ─────────────────────────────────────────────────────
describe("isExportType — clearly invalid strings", () => {
  it("rejects empty string", () => {
    expect(isExportType("")).toBe(false);
  });

  it("rejects a random unknown type", () => {
    expect(isExportType("not-an-exporter")).toBe(false);
  });
});
