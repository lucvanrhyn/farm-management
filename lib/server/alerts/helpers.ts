// lib/server/alerts/helpers.ts — Date/ISO-week helpers for alert dedup keys.
//
// Extracted so every generator computes identical keys and so unit tests can
// stub time-only math without touching Prisma.

import { logger } from "@/lib/logger";

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function diffDays(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseIsoDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * ISO week number `YYYY-Www` (ISO-8601 week date) — used for weekly dedupKeys
 * so a stale-cover alert collapsed by camp is one row per ISO week at most.
 */
export function toIsoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** Default expiry for most alerts — 48h from now. Callers can override. */
export function defaultExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + 48 * 60 * 60 * 1000);
}

/** Parse the speciesAlertThresholds JSON blob from FarmSettings safely. */
export function parseSpeciesThresholds(
  raw: string | null | undefined,
): Record<string, Record<string, unknown>> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, Record<string, unknown>>;
    }
    return {};
  } catch {
    // Corrupt JSON is a settings bug — log once, don't throw. The generator
    // already falls back to its own defaults, so the daily run still produces
    // alerts even when the admin UI wrote bad JSON.
    logger.warn('[alerts] speciesAlertThresholds is not valid JSON');
    return {};
  }
}
