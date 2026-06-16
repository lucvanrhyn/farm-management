/**
 * @vitest-environment node
 *
 * lib/server/briefing/__tests__/iso-week.test.ts — ISO-8601 year-week stamp.
 *
 * Used as the per-tenant per-week idempotency component for the weekly briefing
 * Inngest event id (`weekly-briefing/{slug}/{isoYearWeek}`). Must be:
 *   - deterministic (same date → same stamp)
 *   - "YYYY-Www" formatted, zero-padded week
 *   - stable across the week (Mon..Sun of the same ISO week → same stamp)
 *   - correct around the year boundary (ISO weeks belong to the year of their
 *     Thursday).
 */

import { describe, it, expect } from "vitest";
import { isoYearWeek } from "../iso-week";

describe("isoYearWeek", () => {
  it("formats as YYYY-Www with a zero-padded week", () => {
    // 2026-01-05 is a Monday in ISO week 02 of 2026.
    expect(isoYearWeek(new Date("2026-01-05T05:00:00Z"))).toBe("2026-W02");
  });

  it("is stable across all days of the same ISO week", () => {
    // ISO week starts Monday. 2026-06-15 (Mon) .. 2026-06-21 (Sun).
    const monday = isoYearWeek(new Date("2026-06-15T00:00:00Z"));
    const sunday = isoYearWeek(new Date("2026-06-21T23:59:00Z"));
    expect(monday).toBe(sunday);
  });

  it("assigns the year-boundary week to the year of its Thursday (ISO rule)", () => {
    // 2027-01-01 is a Friday → it belongs to ISO week 53 of 2026.
    expect(isoYearWeek(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
  });

  it("is deterministic", () => {
    const d = new Date("2026-03-10T08:00:00Z");
    expect(isoYearWeek(d)).toBe(isoYearWeek(d));
  });
});
