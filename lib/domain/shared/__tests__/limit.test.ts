/**
 * @vitest-environment node
 *
 * Issue #485 — shared `parseLimit` validator.
 *
 * Single owner of the `?limit` query-param contract used by every list
 * endpoint (animals / observations / tasks). Converges the three
 * historically-divergent answers (animals' `{ error: "Invalid limit" }`,
 * observations' SILENT clamp, tasks' typed `InvalidLimitError`) onto the
 * tasks contract: a non-finite / ≤0 limit throws the canonical
 * `InvalidLimitError` (→ `INVALID_LIMIT` 400 via `mapApiDomainError`);
 * a missing / empty param uses the per-route `fallback`; a valid param
 * clamps to the per-route `max`.
 */
import { describe, it, expect } from "vitest";

import { parseLimit, InvalidLimitError, INVALID_LIMIT } from "../limit";

const OPTS = { max: 2000, fallback: 500 };

describe("parseLimit(raw, { max, fallback })", () => {
  it("returns the fallback when the param is null (omitted)", () => {
    expect(parseLimit(null, OPTS)).toBe(500);
  });

  it("returns the fallback when the param is an empty string", () => {
    expect(parseLimit("", OPTS)).toBe(500);
  });

  it("returns a valid positive integer unchanged when below the cap", () => {
    expect(parseLimit("50", OPTS)).toBe(50);
  });

  it("clamps a too-large value down to the cap", () => {
    expect(parseLimit("99999", OPTS)).toBe(2000);
  });

  it("returns exactly the cap when the value equals the cap", () => {
    expect(parseLimit("2000", OPTS)).toBe(2000);
  });

  it.each([
    ["a non-numeric string", "abc"],
    ["zero", "0"],
    ["a negative value", "-5"],
  ])("throws InvalidLimitError on %s", (_label, raw) => {
    expect(() => parseLimit(raw, OPTS)).toThrowError(InvalidLimitError);
  });

  it("carries the canonical INVALID_LIMIT wire code on the thrown error", () => {
    try {
      parseLimit("-5", OPTS);
      throw new Error("expected parseLimit to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidLimitError);
      expect((err as InvalidLimitError).code).toBe(INVALID_LIMIT);
      expect((err as InvalidLimitError).code).toBe("INVALID_LIMIT");
    }
  });

  it("honours a different per-route cap (observations: 200)", () => {
    expect(parseLimit("5000", { max: 200, fallback: 50 })).toBe(200);
    expect(parseLimit(null, { max: 200, fallback: 50 })).toBe(50);
  });
});
