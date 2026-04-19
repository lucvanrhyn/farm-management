/**
 * lib/tasks/recurrence.ts
 *
 * Pure function — ZERO module-scope env reads, ZERO I/O.
 *
 * Expands a recurrence rule into concrete Date[] within a horizon window,
 * starting from `fromDate`. Supports:
 *
 *   1. RFC5545 RRULE strings — delegated to the `rrule` npm package.
 *   2. Livestock shortcuts:
 *      - `after:<eventType>+<Nd>`                    — N days after each event
 *      - `after:<eventType>+<Nd>,repeat:<Md>`        — same + repeat every M days
 *      - `before:<eventType>-<Nd>`                   — N days before each event
 *      - `season:<key>`                              — at each window start
 *
 * Unknown / malformed rules throw `Error("UNKNOWN_RECURRENCE_RULE")` so callers
 * can surface a typed error code to the UI (silent-failure pattern cure per MEMORY.md).
 */

import { RRule } from "rrule";

// ── Public types ──────────────────────────────────────────────────────────────

export interface LivestockEvent {
  type: string;
  at: Date;
}

export interface SeasonWindow {
  start: Date;
  end: Date;
}

export interface ExpandContext {
  events?: LivestockEvent[];
  seasonWindows?: Record<string, SeasonWindow[]>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_HORIZON_DAYS = 90;

// Regex patterns for livestock shortcuts
// after:<eventType>+<Nd>[,repeat:<Md>]
const AFTER_RE = /^after:([a-z_]+)\+(\d+)d(?:,repeat:(\d+)d)?$/;
// before:<eventType>-<Nd>
const BEFORE_RE = /^before:([a-z_]+)-(\d+)d$/;
// season:<key>
const SEASON_RE = /^season:([a-z0-9_]+)$/;

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Expands `rule` into concrete Date occurrences within the window
 * [fromDate, fromDate + horizonDays].
 *
 * Results are sorted ascending and guaranteed to lie within the window.
 *
 * @param rule        - RRULE string or livestock shortcut string
 * @param fromDate    - Window start (inclusive)
 * @param horizonDays - Window length in days (default 90)
 * @param ctx         - Optional livestock context (events, seasonWindows)
 * @throws Error("UNKNOWN_RECURRENCE_RULE") for unrecognised / malformed rules
 */
export function expandRule(
  rule: string,
  fromDate: Date,
  horizonDays: number = DEFAULT_HORIZON_DAYS,
  ctx?: ExpandContext,
): Date[] {
  if (!rule || rule.trim() === "") {
    throw new Error("UNKNOWN_RECURRENCE_RULE");
  }

  const horizonEnd = new Date(
    fromDate.getTime() + horizonDays * 24 * 60 * 60 * 1000,
  );

  // ── Livestock shortcut: after:<event>+<N>d[,repeat:<M>d] ──
  const afterMatch = rule.match(AFTER_RE);
  if (afterMatch) {
    return expandAfter(afterMatch, fromDate, horizonEnd, ctx);
  }

  // ── Livestock shortcut: before:<event>-<N>d ──
  const beforeMatch = rule.match(BEFORE_RE);
  if (beforeMatch) {
    return expandBefore(beforeMatch, fromDate, horizonEnd, ctx);
  }

  // ── Livestock shortcut: season:<key> ──
  const seasonMatch = rule.match(SEASON_RE);
  if (seasonMatch) {
    return expandSeason(seasonMatch, fromDate, horizonEnd, ctx);
  }

  // ── RFC5545 RRULE ──
  // Must start with FREQ= to be treated as an RRULE (avoids swallowing
  // truly unknown strings silently).
  if (rule.startsWith("FREQ=") || rule.startsWith("RRULE:")) {
    return expandRRule(rule, fromDate, horizonEnd);
  }

  throw new Error("UNKNOWN_RECURRENCE_RULE");
}

// ── Private helpers ───────────────────────────────────────────────────────────

function dayMs(): number {
  return 24 * 60 * 60 * 1000;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * dayMs());
}

function withinWindow(date: Date, from: Date, end: Date): boolean {
  return date.getTime() >= from.getTime() && date.getTime() <= end.getTime();
}

function sortedAsc(dates: Date[]): Date[] {
  return [...dates].sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Expand RRULE string using the rrule package.
 * dtstart is set to fromDate so occurrences begin at the window start.
 */
function expandRRule(rule: string, from: Date, end: Date): Date[] {
  // Strip any leading "RRULE:" prefix
  const ruleStr = rule.startsWith("RRULE:") ? rule.slice(6) : rule;

  let rrule: RRule;
  try {
    // Parse the rule string. rrule.fromString handles RRULE: prefix too but we
    // normalise above. We set dtstart via the options to anchor to fromDate.
    const parsed = RRule.parseString(ruleStr);
    rrule = new RRule({
      ...parsed,
      dtstart: from,
    });
  } catch {
    // rrule throws on invalid FREQ values etc.
    throw new Error("UNKNOWN_RECURRENCE_RULE");
  }

  // rrule.between returns dates >= from and <= end (inc=true)
  const results = rrule.between(from, end, true);
  return results;
}

/**
 * after:<eventType>+<Nd>[,repeat:<Md>]
 */
function expandAfter(
  match: RegExpMatchArray,
  from: Date,
  end: Date,
  ctx?: ExpandContext,
): Date[] {
  const eventType = match[1];
  const offsetDays = parseInt(match[2], 10);
  const repeatDays = match[3] ? parseInt(match[3], 10) : null;

  const events = (ctx?.events ?? []).filter((e) => e.type === eventType);

  const results: Date[] = [];

  for (const event of events) {
    // First occurrence: event.at + offsetDays
    let candidate = addDays(event.at, offsetDays);

    while (candidate.getTime() <= end.getTime()) {
      if (candidate.getTime() >= from.getTime()) {
        results.push(candidate);
      }
      if (repeatDays === null) break;
      candidate = addDays(candidate, repeatDays);
    }
  }

  return sortedAsc(results);
}

/**
 * before:<eventType>-<Nd>
 */
function expandBefore(
  match: RegExpMatchArray,
  from: Date,
  end: Date,
  ctx?: ExpandContext,
): Date[] {
  const eventType = match[1];
  const offsetDays = parseInt(match[2], 10);

  const events = (ctx?.events ?? []).filter((e) => e.type === eventType);

  const results: Date[] = [];

  for (const event of events) {
    const candidate = addDays(event.at, -offsetDays);
    if (withinWindow(candidate, from, end)) {
      results.push(candidate);
    }
  }

  return sortedAsc(results);
}

/**
 * season:<key> — returns the start of each season window that falls within horizon
 */
function expandSeason(
  match: RegExpMatchArray,
  from: Date,
  end: Date,
  ctx?: ExpandContext,
): Date[] {
  const key = match[1];
  const windows = ctx?.seasonWindows?.[key] ?? [];

  const results: Date[] = [];

  for (const window of windows) {
    if (withinWindow(window.start, from, end)) {
      results.push(window.start);
    }
  }

  return sortedAsc(results);
}
