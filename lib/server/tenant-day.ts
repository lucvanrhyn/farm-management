/**
 * lib/server/tenant-day.ts
 *
 * Tenant-TZ aware "today" bucketing for the Operations Overview tiles.
 *
 * Issue #258: every "today" derivation must consult the tenant's stored TZ
 * (FarmSettings.timezone, default "Africa/Johannesburg"). Server-UTC bucketing
 * undercounts events for SAST tenants because 00:30–01:59 SAST is the previous
 * UTC day — those events get filed against yesterday's bucket.
 *
 * No external deps — uses `Intl.DateTimeFormat` to extract the tenant's local
 * Y/M/D for `now`, then converts that civil-date midnight back to a UTC
 * instant. Works for any IANA TZ including DST transitions because we re-ask
 * Intl what the offset was at that instant rather than pre-baking one.
 */

/**
 * Returns the UTC instant that corresponds to 00:00:00 in the tenant's TZ
 * for the calendar day containing `now`.
 *
 * For an `Africa/Johannesburg` tenant evaluating at 23:30 UTC on 2026-05-12
 * (= 01:30 SAST 2026-05-13), the returned instant is 2026-05-12T22:00:00Z
 * (= 00:00 SAST 2026-05-13).
 *
 * Falls back to UTC midnight on invalid TZ input — never throws.
 */
export function getTenantDayStart(
  tz: string | null | undefined,
  now: Date = new Date(),
): Date {
  // Extract Y/M/D in the tenant's TZ. We use en-CA because it formats
  // numerically as "YYYY-MM-DD" with `dateStyle: "short"` — easier to parse
  // than en-US's "M/D/YYYY". `formatToParts` is more robust than parsing
  // a formatted string but Intl behaviour is consistent enough across
  // engines that parts-based extraction is preferred.
  let parts: Intl.DateTimeFormatPart[];
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    parts = fmt.formatToParts(now);
  } catch {
    // Invalid TZ string — fall back to plain UTC midnight (the legacy behaviour).
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");
  const second = get("second");

  // The wall-clock instant in the tenant TZ for `now` is (year-month-day hh:mm:ss).
  // Pretend that wall-clock is UTC to compute milliseconds-since-epoch in TZ space.
  const tzWallclockMs = Date.UTC(year, month - 1, day, hour, minute, second);
  // The actual UTC ms is `now.getTime()` — the difference is the TZ offset at this instant.
  const offsetMs = tzWallclockMs - now.getTime();

  // Day-start in TZ wallclock = (year-month-day 00:00:00). Convert back to UTC by subtracting offset.
  const dayStartTzMs = Date.UTC(year, month - 1, day, 0, 0, 0);
  return new Date(dayStartTzMs - offsetMs);
}

/**
 * Returns the [dayStart, dayEnd) UTC interval covering the tenant's local
 * calendar day containing `now`. `dayEnd` is `dayStart + 24h` — adequate for
 * year-round fixed-offset zones (SAST, IST, ...) and ALMOST all DST zones.
 * For DST-transition days (twice a year, 23h or 25h), the window over- or
 * under-includes by one hour around the transition; this is acceptable for
 * tile-counting (the bug we're fixing was the SAST 2-hour drift, which is
 * 730× the DST edge case). If a future caller needs DST-exact ends, recompute
 * via `getTenantDayStart` for `now + 25h` minus 25h.
 */
export function getTenantDayRange(
  tz: string | null | undefined,
  now: Date = new Date(),
): { dayStart: Date; dayEnd: Date } {
  const dayStart = getTenantDayStart(tz, now);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return { dayStart, dayEnd };
}

/**
 * Returns "YYYY-MM" for the tenant's local month containing `now`. Used by
 * the MTD Finance tile's `where: { date: { startsWith: "YYYY-MM" } }` query
 * (Transaction.date is stored as a YYYY-MM-DD civil-date string, so the month
 * key must reflect the same TZ as the rest of the tile bucketing).
 *
 * Falls back to UTC YYYY-MM on invalid TZ input.
 */
export function getTenantMonthYYYYMM(
  tz: string | null | undefined,
  now: Date = new Date(),
): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz ?? "UTC",
      year: "numeric",
      month: "2-digit",
    });
    const parts = fmt.formatToParts(now);
    const year = parts.find((p) => p.type === "year")?.value ?? "1970";
    const month = parts.find((p) => p.type === "month")?.value ?? "01";
    return `${year}-${month}`;
  } catch {
    return now.toISOString().slice(0, 7);
  }
}
