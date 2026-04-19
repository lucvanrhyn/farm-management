/**
 * Tests for lib/tasks/recurrence.ts
 * TDD — written before implementation (RED phase).
 *
 * 30+ fixtures covering:
 * - RFC5545 RRULE strings
 * - Livestock shortcuts: after:<event>+<Nd>, after:<event>+<Nd>,repeat:<Nd>
 * - Livestock shortcuts: before:<event>-<Nd>
 * - Livestock shortcuts: season:<key>
 * - Horizon clipping
 * - Empty context edge cases
 * - Unknown shortcut error
 * - DST boundary (Johannesburg TZ)
 * - Midnight wrap
 */
import { describe, it, expect } from "vitest";
import { expandRule } from "@/lib/tasks/recurrence";
import type { ExpandContext } from "@/lib/tasks/recurrence";

// Helper: create a UTC date
function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

// Helper: extract YYYY-MM-DD string from Date
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ────────────────────────────────────────────────────────────────
// RRULE tests
// ────────────────────────────────────────────────────────────────
describe("expandRule — RRULE strings", () => {
  it("weekly Mon+Thu for 30 days returns 9 dates (inclusive end = May 6)", () => {
    // DTSTART=2026-04-06 (Monday); end=Apr 6+30d=May 6 (inclusive)
    // Apr 6(Mo), 9(Th), 13(Mo), 16(Th), 20(Mo), 23(Th), 27(Mo), 30(Th), May 4(Mo) = 9
    const from = utc(2026, 4, 6);
    const dates = expandRule("FREQ=WEEKLY;BYDAY=MO,TH", from, 30);
    expect(dates).toHaveLength(9);
    expect(ymd(dates[0])).toBe("2026-04-06");
    expect(ymd(dates[7])).toBe("2026-04-30");
    expect(ymd(dates[8])).toBe("2026-05-04");
  });

  it("monthly on 25th for 180 days returns 6 dates", () => {
    const from = utc(2026, 1, 25);
    const dates = expandRule("FREQ=MONTHLY;BYMONTHDAY=25", from, 180);
    // Jan 25, Feb 25, Mar 25, Apr 25, May 25, Jun 25 = 6 occurrences within 180 days
    expect(dates).toHaveLength(6);
    expect(ymd(dates[0])).toBe("2026-01-25");
    expect(ymd(dates[5])).toBe("2026-06-25");
  });

  it("yearly with BYMONTH=8 returns exactly 1 date within 365-day horizon", () => {
    const from = utc(2026, 1, 1);
    const dates = expandRule("FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=1", from, 365);
    expect(dates).toHaveLength(1);
    expect(ymd(dates[0])).toBe("2026-08-01");
  });

  it("daily RRULE clips to horizon — FREQ=DAILY for 7 days returns 8 dates (inclusive end)", () => {
    const from = utc(2026, 4, 1);
    const dates = expandRule("FREQ=DAILY", from, 7);
    // from=Apr 1, end=Apr 1+7d=Apr 8 (inclusive) → Apr 1..8 = 8 dates
    expect(dates).toHaveLength(8);
    expect(ymd(dates[0])).toBe("2026-04-01");
    expect(ymd(dates[7])).toBe("2026-04-08");
  });

  it("default horizon of 90 days is applied when horizonDays is omitted", () => {
    const from = utc(2026, 4, 1);
    const dates = expandRule("FREQ=DAILY", from);
    // 90 days horizon inclusive: from Apr 1 to Jun 30 = 91 dates (0..90)
    expect(dates).toHaveLength(91);
  });

  it("RRULE with FREQ=WEEKLY returns only occurrences within horizon", () => {
    const from = utc(2026, 4, 1);
    const dates = expandRule("FREQ=WEEKLY", from, 21);
    // from=Apr 1, end=Apr 22 (inclusive): Apr 1, 8, 15, 22 = 4 dates
    expect(dates).toHaveLength(4);
  });

  it("monthly on day 28 handles shorter months correctly", () => {
    const from = utc(2026, 1, 28);
    const dates = expandRule("FREQ=MONTHLY;BYMONTHDAY=28", from, 90);
    // Jan 28, Feb 28, Mar 28, Apr 28 = 4 within 90 days
    expect(dates).toHaveLength(4);
  });

  it("RRULE with COUNT limit does not exceed count even inside horizon", () => {
    const from = utc(2026, 4, 1);
    const dates = expandRule("FREQ=DAILY;COUNT=3", from, 90);
    expect(dates).toHaveLength(3);
  });

  it("FREQ=YEARLY;BYMONTH=2 fires on Feb 25 annually", () => {
    const from = utc(2026, 2, 25);
    const dates = expandRule("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=25", from, 40);
    expect(dates).toHaveLength(1);
    expect(ymd(dates[0])).toBe("2026-02-25");
  });
});

// ────────────────────────────────────────────────────────────────
// after:<eventType>+<Nd> tests
// ────────────────────────────────────────────────────────────────
describe("expandRule — after:<eventType>+<Nd> shortcut", () => {
  it("after:calving+21d with 3 calving events returns 3 dates", () => {
    const ctx: ExpandContext = {
      events: [
        { type: "calving", at: utc(2026, 3, 1) },
        { type: "calving", at: utc(2026, 3, 15) },
        { type: "calving", at: utc(2026, 3, 30) },
      ],
    };
    const from = utc(2026, 3, 1);
    const dates = expandRule("after:calving+21d", from, 90, ctx);
    expect(dates).toHaveLength(3);
    expect(ymd(dates[0])).toBe("2026-03-22"); // Mar 1 + 21d
    expect(ymd(dates[1])).toBe("2026-04-05"); // Mar 15 + 21d
    expect(ymd(dates[2])).toBe("2026-04-20"); // Mar 30 + 21d
  });

  it("after:calving+21d with empty events list returns empty array", () => {
    const ctx: ExpandContext = { events: [] };
    const from = utc(2026, 4, 1);
    const dates = expandRule("after:calving+21d", from, 90, ctx);
    expect(dates).toHaveLength(0);
  });

  it("after:calving+21d without ctx returns empty array", () => {
    const from = utc(2026, 4, 1);
    const dates = expandRule("after:calving+21d", from, 90);
    expect(dates).toHaveLength(0);
  });

  it("after:calving+21d ignores events of wrong type", () => {
    const ctx: ExpandContext = {
      events: [
        { type: "lambing", at: utc(2026, 3, 1) },
        { type: "calving", at: utc(2026, 3, 10) },
      ],
    };
    const from = utc(2026, 3, 1);
    const dates = expandRule("after:calving+21d", from, 90, ctx);
    expect(dates).toHaveLength(1);
    expect(ymd(dates[0])).toBe("2026-03-31"); // Mar 10 + 21d
  });

  it("after:mating_start+45d generates correct date", () => {
    const ctx: ExpandContext = {
      events: [{ type: "mating_start", at: utc(2026, 2, 1) }],
    };
    const from = utc(2026, 2, 1);
    const dates = expandRule("after:mating_start+45d", from, 90, ctx);
    expect(dates).toHaveLength(1);
    expect(ymd(dates[0])).toBe("2026-03-18"); // Feb 1 + 45d
  });

  it("after event that falls outside horizon is excluded", () => {
    const ctx: ExpandContext = {
      events: [{ type: "calving", at: utc(2026, 4, 1) }],
    };
    const from = utc(2026, 4, 1);
    // +100d would put it at Jul 10 — outside 90d horizon (Jun 30)
    const dates = expandRule("after:calving+100d", from, 90, ctx);
    expect(dates).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────
// after:<eventType>+<Nd>,repeat:<Nd> tests
// ────────────────────────────────────────────────────────────────
describe("expandRule — after:<eventType>+<Nd>,repeat:<Nd> shortcut", () => {
  it("after:calving+21d,repeat:21d with 1 calving within 90d horizon → 4 dates", () => {
    const ctx: ExpandContext = {
      events: [{ type: "calving", at: utc(2026, 3, 1) }],
    };
    const from = utc(2026, 3, 1);
    // First: Mar 1 + 21 = Mar 22; then +21d each: Apr 12, May 3, May 24 (within 90d = May 30)
    const dates = expandRule("after:calving+21d,repeat:21d", from, 90, ctx);
    expect(dates.length).toBeGreaterThanOrEqual(4);
    expect(ymd(dates[0])).toBe("2026-03-22");
    expect(ymd(dates[1])).toBe("2026-04-12");
    expect(ymd(dates[2])).toBe("2026-05-03");
    expect(ymd(dates[3])).toBe("2026-05-24");
  });

  it("repeat chain stops at horizon boundary", () => {
    const ctx: ExpandContext = {
      events: [{ type: "calving", at: utc(2026, 4, 1) }],
    };
    const from = utc(2026, 4, 1);
    const dates = expandRule("after:calving+21d,repeat:21d", from, 30, ctx);
    // Apr 1 + 21 = Apr 22 = day 22 of horizon (within 30d); Apr 22 + 21 = May 13 = day 43, outside
    expect(dates).toHaveLength(1);
    expect(ymd(dates[0])).toBe("2026-04-22");
  });

  it("repeat generates occurrences for multiple events independently", () => {
    const ctx: ExpandContext = {
      events: [
        { type: "calving", at: utc(2026, 3, 1) },
        { type: "calving", at: utc(2026, 3, 8) },
      ],
    };
    const from = utc(2026, 3, 1);
    const dates = expandRule("after:calving+21d,repeat:21d", from, 30, ctx);
    // Mar 1 → Mar 22 (within 30d); Mar 8 → Mar 29 (within 30d)
    // Next repeats would be Apr 12 and Apr 19 — outside 30d
    expect(dates).toHaveLength(2);
    const dateStrs = dates.map(ymd).sort();
    expect(dateStrs).toContain("2026-03-22");
    expect(dateStrs).toContain("2026-03-29");
  });
});

// ────────────────────────────────────────────────────────────────
// before:<eventType>-<Nd> tests
// ────────────────────────────────────────────────────────────────
describe("expandRule — before:<eventType>-<Nd> shortcut", () => {
  it("before:lambing-30d with 2 lambing events returns up to 2 dates", () => {
    const ctx: ExpandContext = {
      events: [
        { type: "lambing", at: utc(2026, 6, 1) },
        { type: "lambing", at: utc(2026, 7, 1) },
      ],
    };
    const from = utc(2026, 4, 19);
    const dates = expandRule("before:lambing-30d", from, 120, ctx);
    // Jun 1 - 30 = May 2; Jul 1 - 30 = Jun 1 — both within 120d from Apr 19
    expect(dates).toHaveLength(2);
    expect(ymd(dates[0])).toBe("2026-05-02");
    expect(ymd(dates[1])).toBe("2026-06-01");
  });

  it("before:lambing-30d where result is before fromDate is excluded", () => {
    const ctx: ExpandContext = {
      events: [
        { type: "lambing", at: utc(2026, 4, 10) }, // Apr 10 - 30d = Mar 11 — before fromDate Apr 19
        { type: "lambing", at: utc(2026, 7, 1) },   // Jul 1 - 30d = Jun 1 — within horizon
      ],
    };
    const from = utc(2026, 4, 19);
    const dates = expandRule("before:lambing-30d", from, 90, ctx);
    // Mar 11 is before fromDate Apr 19 — excluded
    expect(dates).toHaveLength(1);
    expect(ymd(dates[0])).toBe("2026-06-01");
  });

  it("before:lambing-30d with empty events returns empty array", () => {
    const ctx: ExpandContext = { events: [] };
    const from = utc(2026, 4, 1);
    const dates = expandRule("before:lambing-30d", from, 90, ctx);
    expect(dates).toHaveLength(0);
  });

  it("before: shortcut ignores events of the wrong type", () => {
    const ctx: ExpandContext = {
      events: [
        { type: "calving", at: utc(2026, 6, 1) },
        { type: "lambing", at: utc(2026, 6, 15) },
      ],
    };
    const from = utc(2026, 4, 1);
    const dates = expandRule("before:lambing-30d", from, 90, ctx);
    expect(dates).toHaveLength(1);
    expect(ymd(dates[0])).toBe("2026-05-16"); // Jun 15 - 30d
  });
});

// ────────────────────────────────────────────────────────────────
// season:<key> tests
// ────────────────────────────────────────────────────────────────
describe("expandRule — season:<key> shortcut", () => {
  it("season:spring_autumn_dip with 2 windows returns 2 dates at window start", () => {
    const ctx: ExpandContext = {
      seasonWindows: {
        spring_autumn_dip: [
          { start: utc(2026, 9, 1), end: utc(2026, 10, 31) },
          { start: utc(2026, 3, 1), end: utc(2026, 4, 30) },
        ],
      },
    };
    const from = utc(2026, 3, 1);
    const dates = expandRule("season:spring_autumn_dip", from, 200, ctx);
    expect(dates).toHaveLength(2);
    const dateStrs = dates.map(ymd).sort();
    expect(dateStrs).toContain("2026-03-01");
    expect(dateStrs).toContain("2026-09-01");
  });

  it("season window starts before fromDate are excluded", () => {
    const ctx: ExpandContext = {
      seasonWindows: {
        spring_autumn_dip: [
          { start: utc(2026, 3, 1), end: utc(2026, 4, 30) }, // before fromDate
          { start: utc(2026, 9, 1), end: utc(2026, 10, 31) },
        ],
      },
    };
    const from = utc(2026, 4, 20); // after first window start
    const dates = expandRule("season:spring_autumn_dip", from, 200, ctx);
    expect(dates).toHaveLength(1);
    expect(ymd(dates[0])).toBe("2026-09-01");
  });

  it("season:<key> with no matching key in ctx returns empty array", () => {
    const ctx: ExpandContext = {
      seasonWindows: { other_key: [{ start: utc(2026, 9, 1), end: utc(2026, 10, 31) }] },
    };
    const from = utc(2026, 4, 1);
    const dates = expandRule("season:spring_autumn_dip", from, 200, ctx);
    expect(dates).toHaveLength(0);
  });

  it("season:<key> without seasonWindows in ctx returns empty array", () => {
    const from = utc(2026, 4, 1);
    const dates = expandRule("season:spring_autumn_dip", from, 200);
    expect(dates).toHaveLength(0);
  });

  it("season window outside horizon is excluded", () => {
    const ctx: ExpandContext = {
      seasonWindows: {
        spring_autumn_dip: [
          { start: utc(2026, 9, 1), end: utc(2026, 10, 31) }, // 135+ days out
        ],
      },
    };
    const from = utc(2026, 4, 1);
    const dates = expandRule("season:spring_autumn_dip", from, 30, ctx);
    expect(dates).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────
// Error / edge-case tests
// ────────────────────────────────────────────────────────────────
describe("expandRule — error handling and edge cases", () => {
  it("unknown shortcut syntax throws UNKNOWN_RECURRENCE_RULE", () => {
    expect(() => expandRule("monthly:dipping", utc(2026, 4, 1), 90)).toThrow(
      "UNKNOWN_RECURRENCE_RULE",
    );
  });

  it("completely invalid string throws UNKNOWN_RECURRENCE_RULE", () => {
    expect(() => expandRule("not-a-rule!!!", utc(2026, 4, 1), 90)).toThrow(
      "UNKNOWN_RECURRENCE_RULE",
    );
  });

  it("empty string throws UNKNOWN_RECURRENCE_RULE", () => {
    expect(() => expandRule("", utc(2026, 4, 1), 90)).toThrow(
      "UNKNOWN_RECURRENCE_RULE",
    );
  });

  it("RRULE with malformed FREQ throws an error", () => {
    expect(() => expandRule("FREQ=BADVALUE;INTERVAL=1", utc(2026, 4, 1), 30)).toThrow();
  });

  it("horizon of 0 days returns only fromDate if rule fires on day 0", () => {
    // FREQ=DAILY means fromDate itself is day 0 occurrence
    const from = utc(2026, 4, 1);
    const dates = expandRule("FREQ=DAILY", from, 0);
    expect(dates).toHaveLength(1);
    expect(ymd(dates[0])).toBe("2026-04-01");
  });

  it("horizon of 1 day includes fromDate and next day for FREQ=DAILY", () => {
    const from = utc(2026, 4, 1);
    const dates = expandRule("FREQ=DAILY", from, 1);
    expect(dates).toHaveLength(2);
  });

  it("after: shortcut with malformed offset (no 'd') throws UNKNOWN_RECURRENCE_RULE", () => {
    const ctx: ExpandContext = {
      events: [{ type: "calving", at: utc(2026, 3, 1) }],
    };
    expect(() => expandRule("after:calving+21", utc(2026, 3, 1), 90, ctx)).toThrow(
      "UNKNOWN_RECURRENCE_RULE",
    );
  });

  it("before: shortcut with malformed offset throws UNKNOWN_RECURRENCE_RULE", () => {
    const ctx: ExpandContext = {
      events: [{ type: "lambing", at: utc(2026, 6, 1) }],
    };
    expect(() => expandRule("before:lambing-30", utc(2026, 4, 1), 90, ctx)).toThrow(
      "UNKNOWN_RECURRENCE_RULE",
    );
  });

  it("returned dates are sorted ascending", () => {
    const ctx: ExpandContext = {
      events: [
        { type: "calving", at: utc(2026, 3, 20) },
        { type: "calving", at: utc(2026, 3, 1) },
        { type: "calving", at: utc(2026, 3, 10) },
      ],
    };
    const from = utc(2026, 3, 1);
    const dates = expandRule("after:calving+5d", from, 90, ctx);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i].getTime()).toBeGreaterThanOrEqual(dates[i - 1].getTime());
    }
  });

  it("returned dates are all within [fromDate, fromDate + horizonDays]", () => {
    const from = utc(2026, 4, 1);
    const horizonDays = 45;
    const dates = expandRule("FREQ=DAILY", from, horizonDays);
    const horizonEnd = new Date(from.getTime() + horizonDays * 24 * 60 * 60 * 1000);
    for (const d of dates) {
      expect(d.getTime()).toBeGreaterThanOrEqual(from.getTime());
      expect(d.getTime()).toBeLessThanOrEqual(horizonEnd.getTime());
    }
  });
});

// ────────────────────────────────────────────────────────────────
// DST + timezone tests
// ────────────────────────────────────────────────────────────────
describe("expandRule — DST boundary (Johannesburg TZ equivalence)", () => {
  it("FREQ=DAILY across April DST transition in South Africa keeps 24h cadence", () => {
    // SAST (UTC+2) has no DST, but rrule uses UTC internally. Test that
    // consecutive daily occurrences are always exactly 24h apart.
    // from=Mar 28, horizon=7d → end=Apr 4 (inclusive) = 8 dates
    const from = utc(2026, 3, 28);
    const dates = expandRule("FREQ=DAILY", from, 7);
    expect(dates.length).toBeGreaterThanOrEqual(7);
    const dayMs = 24 * 60 * 60 * 1000;
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i].getTime() - dates[i - 1].getTime()).toBe(dayMs);
    }
  });

  it("FREQ=DAILY;BYHOUR=0 midnight wrap preserves daily cadence", () => {
    // Ensure midnight-anchored daily rules don't skip or duplicate days
    // from=Mar 1, horizon=7d → end=Mar 8 (inclusive) = 8 dates
    const from = utc(2026, 3, 1);
    const dates = expandRule("FREQ=DAILY;BYHOUR=0", from, 7);
    expect(dates.length).toBeGreaterThanOrEqual(7);
    const dayMs = 24 * 60 * 60 * 1000;
    for (let i = 1; i < dates.length; i++) {
      const delta = dates[i].getTime() - dates[i - 1].getTime();
      expect(delta).toBe(dayMs);
    }
  });

  it("FREQ=WEEKLY across European DST (March) keeps 7-day cadence", () => {
    // from=Mar 1, horizon=28d → end=Mar 29 (inclusive): Mar 1, 8, 15, 22, 29 = 5 dates
    const from = utc(2026, 3, 1);
    const dates = expandRule("FREQ=WEEKLY", from, 28);
    expect(dates.length).toBeGreaterThanOrEqual(4);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i].getTime() - dates[i - 1].getTime()).toBe(weekMs);
    }
  });
});

// ────────────────────────────────────────────────────────────────
// Seed template RRULE validation (smoke tests)
// ────────────────────────────────────────────────────────────────
describe("expandRule — seed template RRULE smoke tests", () => {
  it("FREQ=MONTHLY;INTERVAL=8 parses without throwing", () => {
    const from = utc(2026, 1, 1);
    expect(() => expandRule("FREQ=MONTHLY;INTERVAL=8", from, 365)).not.toThrow();
  });

  it("FREQ=YEARLY;BYMONTH=8 parses without throwing", () => {
    const from = utc(2026, 1, 1);
    expect(() => expandRule("FREQ=YEARLY;BYMONTH=8", from, 365)).not.toThrow();
  });

  it("FREQ=YEARLY;BYMONTH=9 parses without throwing", () => {
    const from = utc(2026, 1, 1);
    expect(() => expandRule("FREQ=YEARLY;BYMONTH=9", from, 365)).not.toThrow();
  });

  it("FREQ=WEEKLY;BYDAY=MO;BYHOUR=7 parses without throwing", () => {
    const from = utc(2026, 1, 5); // Monday
    expect(() => expandRule("FREQ=WEEKLY;BYDAY=MO;BYHOUR=7", from, 90)).not.toThrow();
  });

  it("FREQ=DAILY;INTERVAL=21 parses without throwing", () => {
    const from = utc(2026, 1, 1);
    expect(() => expandRule("FREQ=DAILY;INTERVAL=21", from, 90)).not.toThrow();
  });

  it("FREQ=DAILY;INTERVAL=30 parses without throwing", () => {
    const from = utc(2026, 1, 1);
    expect(() => expandRule("FREQ=DAILY;INTERVAL=30", from, 90)).not.toThrow();
  });

  it("FREQ=DAILY;INTERVAL=14 parses without throwing", () => {
    const from = utc(2026, 1, 1);
    expect(() => expandRule("FREQ=DAILY;INTERVAL=14", from, 90)).not.toThrow();
  });

  it("FREQ=YEARLY;BYMONTH=4 parses without throwing", () => {
    const from = utc(2026, 1, 1);
    expect(() => expandRule("FREQ=YEARLY;BYMONTH=4", from, 365)).not.toThrow();
  });

  it("FREQ=YEARLY;BYMONTH=10 parses without throwing", () => {
    const from = utc(2026, 1, 1);
    expect(() => expandRule("FREQ=YEARLY;BYMONTH=10", from, 365)).not.toThrow();
  });

  it("FREQ=YEARLY;BYMONTH=2 parses without throwing", () => {
    const from = utc(2026, 1, 1);
    expect(() => expandRule("FREQ=YEARLY;BYMONTH=2", from, 365)).not.toThrow();
  });

  it("FREQ=MONTHLY;BYMONTHDAY=25 parses without throwing", () => {
    const from = utc(2026, 1, 1);
    expect(() => expandRule("FREQ=MONTHLY;BYMONTHDAY=25", from, 90)).not.toThrow();
  });

  it("after:mating_start+45d livestock shortcut is recognised as valid", () => {
    const ctx: ExpandContext = { events: [] };
    // No error thrown — just returns empty (no events)
    expect(() => expandRule("after:mating_start+45d", utc(2026, 1, 1), 90, ctx)).not.toThrow();
  });

  it("season:spring_autumn_dip livestock shortcut is recognised as valid", () => {
    const ctx: ExpandContext = { seasonWindows: {} };
    expect(() => expandRule("season:spring_autumn_dip", utc(2026, 1, 1), 90, ctx)).not.toThrow();
  });
});
