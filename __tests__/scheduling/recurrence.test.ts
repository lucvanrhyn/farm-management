import { describe, it, expect } from "vitest";
import {
  nextOccurrence,
  occurrencesBetween,
  isDue,
  type RecurrenceRule,
} from "@/lib/scheduling/recurrence";

// Use UTC dates throughout so test outcomes are deterministic regardless of
// the machine timezone. rrule internally treats `dtstart` as local time, but
// since we only care about the date-level cadence (8 months, 6 months, etc.)
// UTC anchors keep the math unambiguous.
function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

describe("lib/scheduling/recurrence", () => {
  describe("nextOccurrence", () => {
    it("returns the next occurrence for an 8-month shearing cadence", () => {
      // Shearing Jan 1 2025 → next shear Sep 1 2025 → then May 1 2026 ...
      const rule: RecurrenceRule = {
        frequency: "months",
        interval: 8,
        startDate: utc(2025, 1, 1),
      };
      const next = nextOccurrence(rule, utc(2025, 6, 1));
      expect(next).not.toBeNull();
      // +8 months from the Jan 1 anchor.
      expect(next!.toISOString().slice(0, 10)).toBe("2025-09-01");
    });

    it("returns the next occurrence for a 6-month vaccination booster", () => {
      // Last vaccination Feb 15 2025 → next Aug 15 2025.
      const rule: RecurrenceRule = {
        frequency: "months",
        interval: 6,
        startDate: utc(2025, 2, 15),
      };
      const next = nextOccurrence(rule, utc(2025, 5, 1));
      expect(next!.toISOString().slice(0, 10)).toBe("2025-08-15");
    });

    it("returns the anchor date itself when `after` precedes startDate", () => {
      // startDate in the future — rrule treats dtstart as the first occurrence.
      const rule: RecurrenceRule = {
        frequency: "months",
        interval: 3,
        startDate: utc(2026, 12, 1),
      };
      const next = nextOccurrence(rule, utc(2026, 1, 1));
      expect(next!.toISOString().slice(0, 10)).toBe("2026-12-01");
    });

    it("returns null once maxOccurrences is exhausted", () => {
      // Two occurrences: Jan 1 and Feb 1 2025. After Feb 1 → null.
      const rule: RecurrenceRule = {
        frequency: "months",
        interval: 1,
        startDate: utc(2025, 1, 1),
        maxOccurrences: 2,
      };
      const next = nextOccurrence(rule, utc(2025, 3, 1));
      expect(next).toBeNull();
    });
  });

  describe("occurrencesBetween", () => {
    it("returns all occurrences in a year-long window for an 8-month cadence", () => {
      // Jan 1 2025 start, every 8 months → Jan 1 2025, Sep 1 2025, May 1 2026.
      // Window: Jan 1 2025 … Dec 31 2026. Expect three hits.
      const rule: RecurrenceRule = {
        frequency: "months",
        interval: 8,
        startDate: utc(2025, 1, 1),
      };
      const hits = occurrencesBetween(rule, utc(2025, 1, 1), utc(2026, 12, 31));
      expect(hits).toHaveLength(3);
      expect(hits.map((d) => d.toISOString().slice(0, 10))).toEqual([
        "2025-01-01",
        "2025-09-01",
        "2026-05-01",
      ]);
    });

    it("returns an empty array when the window contains no occurrences", () => {
      const rule: RecurrenceRule = {
        frequency: "months",
        interval: 8,
        startDate: utc(2025, 1, 1),
      };
      // Feb–Aug 2025 has no occurrences (Jan 1 is outside, Sep 1 is outside).
      const hits = occurrencesBetween(rule, utc(2025, 2, 1), utc(2025, 8, 15));
      expect(hits).toEqual([]);
    });

    it("throws when start > end", () => {
      const rule: RecurrenceRule = {
        frequency: "days",
        interval: 7,
        startDate: utc(2025, 1, 1),
      };
      expect(() =>
        occurrencesBetween(rule, utc(2025, 2, 1), utc(2025, 1, 1)),
      ).toThrow(/start must be <= end/);
    });
  });

  describe("isDue", () => {
    it("is true exactly at the occurrence with a zero-day window", () => {
      const rule: RecurrenceRule = {
        frequency: "months",
        interval: 6,
        startDate: utc(2025, 1, 1),
      };
      // Next after Jan 1 → Jul 1. Reference date exactly Jul 1.
      expect(isDue(rule, utc(2025, 7, 1), 0)).toBe(true);
    });

    it("is true when a scheduled occurrence is within the symmetric window", () => {
      const rule: RecurrenceRule = {
        frequency: "months",
        interval: 8,
        startDate: utc(2025, 1, 1),
      };
      // Reference Sep 4 2025 with a 7-day window covers Sep 1 2025.
      expect(isDue(rule, utc(2025, 9, 4), 7)).toBe(true);
    });

    it("is false when no occurrence falls within the window", () => {
      const rule: RecurrenceRule = {
        frequency: "months",
        interval: 8,
        startDate: utc(2025, 1, 1),
      };
      // Reference Mar 1 2025 — closest occurrence is Jan 1 (59 days away).
      // 7-day window misses it.
      expect(isDue(rule, utc(2025, 3, 1), 7)).toBe(false);
    });

    it("throws when dueWindowDays is negative", () => {
      const rule: RecurrenceRule = {
        frequency: "months",
        interval: 6,
        startDate: utc(2025, 1, 1),
      };
      expect(() => isDue(rule, utc(2025, 7, 1), -1)).toThrow(
        /must be a non-negative finite number/,
      );
    });
  });

  describe("DST boundary", () => {
    it("keeps cadence stable across a daylight-savings transition", () => {
      // US DST "spring forward" is second Sunday of March. Schedule weekly
      // starting Mar 1 2026; the Mar 15 occurrence crosses the DST boundary.
      // rrule's output should still contain Mar 8, Mar 15 as distinct dates
      // even though clock time jumps — we assert by day-count delta.
      const rule: RecurrenceRule = {
        frequency: "weeks",
        interval: 1,
        startDate: utc(2026, 3, 1),
      };
      const occurrences = occurrencesBetween(rule, utc(2026, 3, 1), utc(2026, 3, 22));
      expect(occurrences).toHaveLength(4); // Mar 1, 8, 15, 22
      const dayMs = 24 * 60 * 60 * 1000;
      expect(occurrences[1].getTime() - occurrences[0].getTime()).toBe(7 * dayMs);
      expect(occurrences[2].getTime() - occurrences[1].getTime()).toBe(7 * dayMs);
      expect(occurrences[3].getTime() - occurrences[2].getTime()).toBe(7 * dayMs);
    });
  });

  describe("input validation", () => {
    it("throws on non-positive interval", () => {
      expect(() =>
        nextOccurrence({
          frequency: "months",
          interval: 0,
          startDate: utc(2025, 1, 1),
        }),
      ).toThrow(/must be a positive integer/);
    });

    it("throws on invalid startDate", () => {
      expect(() =>
        nextOccurrence({
          frequency: "months",
          interval: 6,
          startDate: new Date("not-a-date"),
        }),
      ).toThrow(/valid Date/);
    });
  });
});
