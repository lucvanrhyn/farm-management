/**
 * Server-Timing helper — formats a timings bag into a valid
 * `Server-Timing` header value. The helper is used from every
 * instrumented API route so the cold-perf LHCI workflow can see
 * where time is going per-request without another probe layer.
 *
 * Contract (tested here):
 *   - One entry, three entries → header formats per spec
 *   - Empty object → empty string (caller omits the header)
 *   - >8 entries → truncated to the first 8
 *   - Label-unsafe chars (spaces, commas, semicolons, equals) stripped
 *   - Non-finite durations skipped
 *   - Never throws for any object input
 */
import { describe, it, expect } from "vitest";
import { emitServerTiming } from "@/lib/server/server-timing";

describe("emitServerTiming", () => {
  it("formats a single timing entry", () => {
    expect(emitServerTiming({ session: 12.3 })).toBe("session;dur=12.3");
  });

  it("formats multiple timings joined by `, `", () => {
    expect(
      emitServerTiming({
        session: 5,
        "prisma-acquire": 42.7,
        query: 101.4,
      }),
    ).toBe("session;dur=5, prisma-acquire;dur=42.7, query;dur=101.4");
  });

  it("returns empty string when no timings are provided", () => {
    expect(emitServerTiming({})).toBe("");
  });

  it("truncates to the first 8 entries when more are supplied", () => {
    const bag: Record<string, number> = {};
    for (let i = 0; i < 12; i++) bag[`m${i}`] = i;
    const header = emitServerTiming(bag);
    const parts = header.split(", ");
    expect(parts).toHaveLength(8);
    expect(parts[0]).toBe("m0;dur=0");
    expect(parts[7]).toBe("m7;dur=7");
  });

  it("sanitises labels that contain spaces, commas, semicolons, or equals signs", () => {
    expect(
      emitServerTiming({
        "db query": 10,
        "weird,label": 20,
        "x;y=z": 30,
      }),
    ).toBe("dbquery;dur=10, weirdlabel;dur=20, xyz;dur=30");
  });

  it("skips non-finite durations instead of emitting NaN or Infinity", () => {
    expect(
      emitServerTiming({
        good: 10,
        bad: Number.NaN,
        worse: Number.POSITIVE_INFINITY,
        negative: -1,
      }),
    ).toBe("good;dur=10, negative;dur=-1");
    // Negative kept — negative durations are valid (just unusual). We only
    // drop non-finite to avoid writing an invalid header value.
  });

  it("rounds durations to one decimal place to keep the header short", () => {
    expect(emitServerTiming({ q: 1.23456 })).toBe("q;dur=1.2");
    expect(emitServerTiming({ q: 0.04 })).toBe("q;dur=0");
  });

  it("never throws for any plausible input", () => {
    // Inputs that might come from a try/catch path or a missing probe result.
    expect(() => emitServerTiming({} as Record<string, number>)).not.toThrow();
    expect(() =>
      emitServerTiming({ a: undefined as unknown as number }),
    ).not.toThrow();
    expect(() => emitServerTiming({ "": 5 })).not.toThrow();
  });
});
