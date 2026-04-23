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
import { describe, it, expect, vi } from "vitest";
import {
  emitServerTiming,
  createTimingBag,
  runWithTimingBag,
  recordTiming,
  timeAsync,
  withServerTiming,
} from "@/lib/server/server-timing";

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

describe("withServerTiming route wrapper", () => {
  it("attaches Server-Timing header with bag contents + total", async () => {
    const headers = new Map<string, string>();
    const fakeResponse = {
      headers: {
        set: (n: string, v: string) => {
          headers.set(n, v);
        },
      },
    };

    await withServerTiming(async () => {
      recordTiming("session", 4);
      recordTiming("prisma-acquire", 120);
      return fakeResponse;
    });

    const header = headers.get("Server-Timing") ?? "";
    expect(header).toContain("session;dur=4");
    expect(header).toContain("prisma-acquire;dur=120");
    // `total` is always appended by the wrapper
    expect(header).toMatch(/total;dur=\d/);
  });

  it("omits the header when nothing was recorded (total still present)", async () => {
    const headers = new Map<string, string>();
    const fakeResponse = {
      headers: {
        set: (n: string, v: string) => headers.set(n, v),
      },
    };
    await withServerTiming(async () => fakeResponse);
    // Even with no explicit timings, `total` is recorded; header exists.
    expect(headers.get("Server-Timing")).toMatch(/^total;dur=/);
  });

  it("propagates handler errors unchanged (never swallows)", async () => {
    await expect(
      withServerTiming(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("keeps bags isolated between concurrent requests (ALS scoping)", async () => {
    // Two overlapping withServerTiming calls must NOT bleed timings into
    // each other. This is the core correctness guarantee of the ALS design.
    const resA = {
      headers: { set: vi.fn() },
    };
    const resB = {
      headers: { set: vi.fn() },
    };

    const [headerA, headerB] = await Promise.all([
      withServerTiming(async () => {
        await timeAsync("work", async () => {
          await new Promise((r) => setTimeout(r, 10));
          recordTiming("onlyA", 42);
        });
        return resA;
      }).then(() => (resA.headers.set as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]),
      withServerTiming(async () => {
        await timeAsync("work", async () => {
          await new Promise((r) => setTimeout(r, 15));
          recordTiming("onlyB", 99);
        });
        return resB;
      }).then(() => (resB.headers.set as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]),
    ]);

    expect(headerA).toContain("onlyA;dur=42");
    expect(headerA).not.toContain("onlyB");
    expect(headerB).toContain("onlyB;dur=99");
    expect(headerB).not.toContain("onlyA");
  });
});

describe("timing bag basics", () => {
  it("createTimingBag returns an empty writable bag", () => {
    const bag = createTimingBag();
    expect(bag).toEqual({});
    bag.foo = 1;
    expect(bag.foo).toBe(1);
  });

  it("runWithTimingBag makes recordTiming write into that bag", () => {
    const bag = createTimingBag();
    runWithTimingBag(bag, () => {
      recordTiming("alpha", 7);
    });
    expect(bag.alpha).toBe(7);
  });

  it("recordTiming outside a bag is a silent no-op", () => {
    expect(() => recordTiming("orphan", 5)).not.toThrow();
  });

  it("timeAsync measures the callback into the active bag", async () => {
    const bag = createTimingBag();
    await runWithTimingBag(bag, async () => {
      await timeAsync("work", async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
    });
    expect(bag.work).toBeTypeOf("number");
    expect(bag.work).toBeGreaterThanOrEqual(0);
  });
});
