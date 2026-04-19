/**
 * Phase J9 — Recurrence library for alert generators.
 *
 * Thin wrapper around `rrule@2.8.x` that exposes only the three frequencies
 * FarmTrack alert schedules care about (months / days / weeks), plus a
 * minimal query surface that alert generators can import without dealing
 * with RFC-5545 Weekday objects, IANA timezone wiring, or the Frequency enum.
 *
 * Source-of-truth research: memory/research-phase-j-notifications.md §D
 * (shearing/crutching, vaccination cadence). Kept intentionally tiny so it
 * remains testable and Team NOTIF's generators stay legible.
 *
 * Example recipes the `shearing-crutching.ts` generator will use:
 *
 *   // Shearing every 8 months from last shear
 *   const rule = { frequency: "months", interval: 8, startDate: lastShearingDate };
 *   if (isDue(rule, new Date(), 14)) emitAlert(...);
 *
 *   // Vaccination booster every 6 months
 *   const rule = { frequency: "months", interval: 6, startDate: lastVaccinationDate };
 *   const next = nextOccurrence(rule);
 */

import { RRule, Frequency } from "rrule";

export type RecurrenceFrequency = "months" | "days" | "weeks";

export interface RecurrenceRule {
  /** Unit for `interval`. Only months/days/weeks are supported today. */
  frequency: RecurrenceFrequency;
  /** Recur every N units of `frequency`. Must be a positive integer. */
  interval: number;
  /** Anchor date — rrule treats this as dtstart and is always the first occurrence. */
  startDate: Date;
  /** Optional cap; rrule's `count` parameter. */
  maxOccurrences?: number;
}

const FREQUENCY_MAP: Record<RecurrenceFrequency, Frequency> = {
  days: RRule.DAILY,
  weeks: RRule.WEEKLY,
  months: RRule.MONTHLY,
};

function validateRule(rule: RecurrenceRule): void {
  if (!Number.isFinite(rule.interval) || rule.interval <= 0 || !Number.isInteger(rule.interval)) {
    // Specific error — per memory/silent-failure-pattern.md, never swallow into
    // a generic "something went wrong". Callers need to know WHY.
    throw new Error(
      `[recurrence] invalid interval ${rule.interval} — must be a positive integer`,
    );
  }
  if (!(rule.startDate instanceof Date) || Number.isNaN(rule.startDate.getTime())) {
    throw new Error("[recurrence] startDate must be a valid Date");
  }
  if (rule.maxOccurrences !== undefined) {
    if (
      !Number.isFinite(rule.maxOccurrences) ||
      rule.maxOccurrences <= 0 ||
      !Number.isInteger(rule.maxOccurrences)
    ) {
      throw new Error(
        `[recurrence] invalid maxOccurrences ${rule.maxOccurrences} — must be a positive integer`,
      );
    }
  }
  if (!(rule.frequency in FREQUENCY_MAP)) {
    throw new Error(
      `[recurrence] unsupported frequency "${rule.frequency}" — use months/days/weeks`,
    );
  }
}

function build(rule: RecurrenceRule): RRule {
  validateRule(rule);
  return new RRule({
    freq: FREQUENCY_MAP[rule.frequency],
    interval: rule.interval,
    dtstart: rule.startDate,
    count: rule.maxOccurrences ?? null,
  });
}

/**
 * Returns the next occurrence strictly after `after` (exclusive by default,
 * matching rrule's `inc=false`). If `after` is earlier than `startDate`, the
 * anchor date itself is returned because rrule treats dtstart as the first
 * occurrence.
 *
 * Returns `null` when the rule has a `maxOccurrences` cap that has been
 * exhausted before `after`.
 */
export function nextOccurrence(
  rule: RecurrenceRule,
  after: Date = new Date(),
): Date | null {
  const r = build(rule);
  return r.after(after, false);
}

/**
 * Returns every occurrence in the half-open interval [start, end] (inclusive
 * of both endpoints — rrule's `inc=true`). Empty array if none.
 */
export function occurrencesBetween(
  rule: RecurrenceRule,
  start: Date,
  end: Date,
): Date[] {
  if (start.getTime() > end.getTime()) {
    throw new Error("[recurrence] start must be <= end");
  }
  const r = build(rule);
  return r.between(start, end, true);
}

/**
 * True when an occurrence falls within the window
 *   [referenceDate - dueWindowDays, referenceDate + dueWindowDays]
 *
 * Used by alert generators to decide "fire an alert now" vs. "not yet".
 * The symmetric window means both "just became due" and "overdue by a few
 * days" trigger the same alert, which is what the shearing/crutching/vax
 * generators want.
 */
export function isDue(
  rule: RecurrenceRule,
  referenceDate: Date = new Date(),
  dueWindowDays: number = 0,
): boolean {
  if (!Number.isFinite(dueWindowDays) || dueWindowDays < 0) {
    throw new Error(
      `[recurrence] invalid dueWindowDays ${dueWindowDays} — must be a non-negative finite number`,
    );
  }
  const windowMs = dueWindowDays * 24 * 60 * 60 * 1000;
  const windowStart = new Date(referenceDate.getTime() - windowMs);
  const windowEnd = new Date(referenceDate.getTime() + windowMs);
  const matches = occurrencesBetween(rule, windowStart, windowEnd);
  return matches.length > 0;
}
