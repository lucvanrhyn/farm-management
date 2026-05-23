/**
 * __tests__/lib/server/tenant-day.test.ts
 *
 * Tests for tenant-TZ aware "today" bucketing helpers.
 *
 * Issue #258 — Operations Overview "Calvings Today" tile undercounts because
 * `todayStart = new Date(); todayStart.setHours(0,0,0,0)` zeroes time in the
 * SERVER's local TZ (UTC on Vercel). For an SAST tenant a 01:30 SAST event on
 * day D is 23:30 UTC on D-1, so it falls outside the [00:00 UTC of D, ...) window.
 *
 * `getTenantDayStart(tz, now)` returns the UTC instant that corresponds to
 * 00:00 in the IANA `tz` for the calendar day containing `now`.
 */
import { describe, it, expect } from "vitest";
import {
  getTenantDayStart,
  getTenantDayRange,
  getTenantMonthYYYYMM,
} from "@/lib/server/tenant-day";

describe("getTenantDayStart — Africa/Johannesburg (UTC+2, no DST)", () => {
  it("01:30 SAST on 2026-05-13 (=23:30 UTC on 2026-05-12) buckets into 2026-05-12T22:00:00Z", () => {
    // 01:30 SAST on May 13 is 23:30 UTC on May 12 — same SA calendar day as May 13
    const calving = new Date("2026-05-12T23:30:00Z");
    const start = getTenantDayStart("Africa/Johannesburg", calving);
    // SAST midnight for May 13 is 22:00 UTC on May 12
    expect(start.toISOString()).toBe("2026-05-12T22:00:00.000Z");
  });

  it("00:00 SAST exactly is the start of its own day (boundary lower)", () => {
    // 00:00 SAST May 13 = 22:00 UTC May 12
    const exact = new Date("2026-05-12T22:00:00Z");
    const start = getTenantDayStart("Africa/Johannesburg", exact);
    expect(start.toISOString()).toBe("2026-05-12T22:00:00.000Z");
  });

  it("23:59 SAST is in the same day as 00:00 SAST (boundary upper)", () => {
    // 23:59 SAST May 13 = 21:59 UTC May 13
    const late = new Date("2026-05-13T21:59:00Z");
    const start = getTenantDayStart("Africa/Johannesburg", late);
    // Still SAST May 13 → start is 22:00 UTC May 12
    expect(start.toISOString()).toBe("2026-05-12T22:00:00.000Z");
  });

  it("UTC midnight (= 02:00 SAST) is in the SAST day after the previous SAST day's 22:00Z bucket", () => {
    // 00:00 UTC May 13 = 02:00 SAST May 13 → same SAST day as 22:00 UTC May 12
    const utcMidnight = new Date("2026-05-13T00:00:00Z");
    const start = getTenantDayStart("Africa/Johannesburg", utcMidnight);
    expect(start.toISOString()).toBe("2026-05-12T22:00:00.000Z");
  });

  it("is monotonic across a SAST day (every instant in [22:00Z May 12, 22:00Z May 13) maps to 22:00Z May 12)", () => {
    const samples = [
      new Date("2026-05-12T22:00:00Z"), // 00:00 SAST May 13
      new Date("2026-05-12T23:30:00Z"), // 01:30 SAST May 13 — the bug exemplar
      new Date("2026-05-13T00:00:00Z"), // 02:00 SAST May 13
      new Date("2026-05-13T10:00:00Z"), // 12:00 SAST May 13
      new Date("2026-05-13T21:59:59Z"), // 23:59:59 SAST May 13
    ];
    for (const s of samples) {
      const start = getTenantDayStart("Africa/Johannesburg", s);
      expect(start.toISOString()).toBe("2026-05-12T22:00:00.000Z");
    }
  });
});

describe("getTenantDayStart — UTC tenant (degenerate case)", () => {
  it("for UTC the day-start matches a plain UTC midnight", () => {
    const t = new Date("2026-05-13T15:30:00Z");
    const start = getTenantDayStart("UTC", t);
    expect(start.toISOString()).toBe("2026-05-13T00:00:00.000Z");
  });
});

describe("getTenantDayStart — DST-bearing tenant (America/New_York)", () => {
  it("during EDT (UTC-4) on 2026-07-15 12:00Z, day start is 04:00Z (= 00:00 EDT)", () => {
    const t = new Date("2026-07-15T12:00:00Z");
    const start = getTenantDayStart("America/New_York", t);
    expect(start.toISOString()).toBe("2026-07-15T04:00:00.000Z");
  });

  it("during EST (UTC-5) on 2026-01-15 12:00Z, day start is 05:00Z (= 00:00 EST)", () => {
    const t = new Date("2026-01-15T12:00:00Z");
    const start = getTenantDayStart("America/New_York", t);
    expect(start.toISOString()).toBe("2026-01-15T05:00:00.000Z");
  });
});

describe("getTenantDayStart — invalid TZ falls back gracefully", () => {
  it("invalid TZ string falls back to UTC midnight (do not throw on user-controlled input)", () => {
    const t = new Date("2026-05-13T15:30:00Z");
    const start = getTenantDayStart("Not/AReal_TZ", t);
    expect(start.toISOString()).toBe("2026-05-13T00:00:00.000Z");
  });

  it("null/empty TZ falls back to UTC midnight", () => {
    const t = new Date("2026-05-13T15:30:00Z");
    const start = getTenantDayStart(null, t);
    expect(start.toISOString()).toBe("2026-05-13T00:00:00.000Z");
  });
});

describe("getTenantDayRange — returns [dayStart, dayEnd) 24h window", () => {
  it("SAST May 13 returns [2026-05-12T22:00Z, 2026-05-13T22:00Z)", () => {
    const t = new Date("2026-05-13T10:00:00Z");
    const { dayStart, dayEnd } = getTenantDayRange("Africa/Johannesburg", t);
    expect(dayStart.toISOString()).toBe("2026-05-12T22:00:00.000Z");
    expect(dayEnd.toISOString()).toBe("2026-05-13T22:00:00.000Z");
  });
});

describe("getTenantMonthYYYYMM — month bucket in tenant TZ", () => {
  it("23:30 UTC on 2026-04-30 is May (01:30 SAST) for SAST tenants", () => {
    const t = new Date("2026-04-30T23:30:00Z");
    expect(getTenantMonthYYYYMM("Africa/Johannesburg", t)).toBe("2026-05");
  });

  it("midday UTC matches midday SAST month for the same date", () => {
    const t = new Date("2026-05-13T12:00:00Z");
    expect(getTenantMonthYYYYMM("Africa/Johannesburg", t)).toBe("2026-05");
  });

  it("UTC tenant uses UTC month", () => {
    const t = new Date("2026-04-30T23:30:00Z");
    expect(getTenantMonthYYYYMM("UTC", t)).toBe("2026-04");
  });
});
