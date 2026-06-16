/**
 * lib/server/briefing/iso-week.ts — ISO-8601 year-week stamp.
 *
 * `isoYearWeek(date)` → "YYYY-Www" (e.g. "2026-W25"), used as the per-tenant
 * per-week idempotency component of the weekly-briefing Inngest event id
 * (`weekly-briefing/{slug}/{isoYearWeek}`). Belt-and-suspenders for the
 * once-a-week cron: even if the cron double-fires, the same event id collapses
 * to a single delivery.
 *
 * ISO-8601 rule: weeks start on Monday, and a week belongs to the year that
 * contains its Thursday. PURE + TOTAL: same Date → same string, no I/O, all
 * computation in UTC so it never drifts with the host timezone.
 */

/** Return the "YYYY-Www" ISO-8601 year-week for the given date (UTC). */
export function isoYearWeek(date: Date): string {
  // Work on a UTC copy so the result is timezone-stable.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // ISO weekday: Mon=1 .. Sun=7.
  const dayNum = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  // Shift to the Thursday of this week — its year is the ISO week-year.
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const isoYear = d.getUTCFullYear();
  // Week number = number of weeks from the year's first Thursday.
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}
