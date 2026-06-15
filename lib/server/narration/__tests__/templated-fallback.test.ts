/**
 * @vitest-environment node
 *
 * lib/server/narration/templated-fallback.ts — the shared deterministic offline
 * narrator. Einstein's answer.ts throws when no API key is present (no fallback);
 * this module is the NET-NEW always-available prose layer. It must be PURE and
 * TOTAL: same input → same output, no I/O, no clock read.
 */
import { describe, it, expect } from "vitest";
import {
  joinClauses,
  pluralize,
  templatedFallbackUnavailable,
} from "@/lib/server/narration/templated-fallback";

describe("templated-fallback — pure narration primitives", () => {
  describe("pluralize", () => {
    it("singular for count 1", () => {
      expect(pluralize(1, "animal")).toBe("1 animal");
    });
    it("plural for count != 1", () => {
      expect(pluralize(2, "animal")).toBe("2 animals");
      expect(pluralize(0, "animal")).toBe("0 animals");
    });
    it("honours an explicit irregular plural", () => {
      expect(pluralize(3, "cow", "cattle")).toBe("3 cattle");
      expect(pluralize(1, "cow", "cattle")).toBe("1 cow");
    });
  });

  describe("joinClauses — Oxford-style natural-language list", () => {
    it("empty list → empty string", () => {
      expect(joinClauses([])).toBe("");
    });
    it("single clause → verbatim", () => {
      expect(joinClauses(["no camp"])).toBe("no camp");
    });
    it("two clauses → ' and '", () => {
      expect(joinClauses(["no camp", "no ID"])).toBe("no camp and no ID");
    });
    it("three+ clauses → comma list with Oxford 'and'", () => {
      expect(joinClauses(["a", "b", "c"])).toBe("a, b, and c");
    });
    it("is deterministic — same input, same output", () => {
      const input = ["x", "y", "z"];
      expect(joinClauses(input)).toBe(joinClauses(input));
    });
  });

  describe("templatedFallbackUnavailable", () => {
    it("returns a stable, non-empty message (no key / offline path)", () => {
      const msg = templatedFallbackUnavailable();
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
      // total + deterministic
      expect(templatedFallbackUnavailable()).toBe(msg);
    });
  });
});
