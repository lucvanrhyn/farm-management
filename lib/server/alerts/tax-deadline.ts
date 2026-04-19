// lib/server/alerts/tax-deadline.ts — TAX_DEADLINE_IT3 / TAX_DEADLINE_VAT (MOAT).
//
// Research brief §D row 10: hard-coded SA tax deadlines, fired at T-14d and
// T-3d. IT3 = Feb 28 (tax year end); VAT = 25th of each month.

import type { PrismaClient, FarmSettings } from "@prisma/client";
import type { AlertCandidate } from "./types";
import { defaultExpiry, diffDays, toIsoDate } from "./helpers";

const LEAD_WINDOWS_DAYS: readonly number[] = [14, 3];

function nextFeb28(now: Date): Date {
  const year = now.getUTCFullYear();
  const thisYear = new Date(Date.UTC(year, 1, 28));
  if (thisYear >= startOfDay(now)) return thisYear;
  return new Date(Date.UTC(year + 1, 1, 28));
}

function nextVat25(now: Date): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const thisMonth = new Date(Date.UTC(year, month, 25));
  if (thisMonth >= startOfDay(now)) return thisMonth;
  return new Date(Date.UTC(year, month + 1, 25));
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function evaluate(
  _prisma: PrismaClient,
  _settings: FarmSettings,
  _farmSlug?: string,
): Promise<AlertCandidate[]> {
  const now = new Date();
  const candidates: AlertCandidate[] = [];
  const expiresAt = defaultExpiry(now);

  // ── IT3 (annual) ──────────────────────────────────────────────────────────
  const it3 = nextFeb28(now);
  const daysToIt3 = diffDays(startOfDay(it3), startOfDay(now));
  for (const lead of LEAD_WINDOWS_DAYS) {
    if (daysToIt3 === lead) {
      candidates.push({
        type: "TAX_DEADLINE_IT3",
        category: "compliance",
        severity: lead === 3 ? "red" : "amber",
        dedupKey: `TAX_DEADLINE_IT3:farm:${toIsoDate(it3)}:${lead}d`,
        collapseKey: null,
        payload: { deadline: toIsoDate(it3), leadDays: lead, type: "IT3" },
        message: `IT3 farming tax deadline in ${lead} day${lead === 1 ? "" : "s"} (${toIsoDate(it3)})`,
        href: `/admin/tax/it3`,
        expiresAt,
      });
    }
  }

  // ── VAT (monthly, 25th) ───────────────────────────────────────────────────
  const vat = nextVat25(now);
  const daysToVat = diffDays(startOfDay(vat), startOfDay(now));
  for (const lead of LEAD_WINDOWS_DAYS) {
    if (daysToVat === lead) {
      candidates.push({
        type: "TAX_DEADLINE_VAT",
        category: "compliance",
        severity: lead === 3 ? "red" : "amber",
        dedupKey: `TAX_DEADLINE_VAT:farm:${toIsoDate(vat)}:${lead}d`,
        collapseKey: null,
        payload: { deadline: toIsoDate(vat), leadDays: lead, type: "VAT" },
        message: `VAT submission deadline in ${lead} day${lead === 1 ? "" : "s"} (${toIsoDate(vat)})`,
        href: `/admin/tax/vat`,
        expiresAt,
      });
    }
  }

  return candidates;
}
