/**
 * lib/einstein/budget.ts — Phase L Wave 2B per-tenant ZAR budget.
 *
 * Pattern borrowed from lib/server/alerts/dispatch.ts §"Mark-before-send":
 * we UPDATE the spent-counter BEFORE the Anthropic call fires. If the SDK
 * throws or Inngest retries the step, we've already stamped — so at-most-once
 * semantics hold. A possible missed-debit is acceptable (user gets a bonus
 * token); a double-bill would be unacceptable.
 *
 * Tier rules (per Scope-C lock 2026-04-20):
 *   basic        → never reaches here (route gate catches first)
 *   advanced     → budgeted ZAR 100/mo default, enforced here
 *   consulting   → budget-exempt (isBudgetExempt → true)
 *
 * Storage (EIN-1 / slice S23 — atomic counter):
 *   The CAP + kill-switch stay in the `aiSettings` JSON blob's `ragConfig`
 *   (rarely written, edited only from the admin form):
 *     { ragConfig: { enabled, budgetCapZarPerMonth } }
 *   The VOLATILE spend counter moved to dedicated columns so the three writers
 *   can use single-statement atomic SQL instead of a lost-update-prone
 *   read-modify-write of the whole blob:
 *     FarmSettings.aiBudgetMonthSpentZar  REAL  (running ZAR spend this window)
 *     FarmSettings.aiBudgetMonthKey       TEXT  ("YYYY-MM" the counter belongs to)
 *
 *   Why columns: two concurrent Einstein queries each used to read spent=50 and
 *   each write 50+cost → one increment was LOST → budget undercounted → AI
 *   overspend. You cannot atomically increment a number buried in a JSON string
 *   column, so the counter is now a first-class REAL column updated with
 *   `SET col = col + ?` in one statement. The DB serializes the statement;
 *   concurrent increments compose instead of clobbering.
 */

import type { PrismaClient } from '@prisma/client';
import type { FarmTier } from '@/lib/tier';
import { isBudgetExempt } from '@/lib/tier';
import { getPrismaForFarm } from '@/lib/farm-prisma';
import { getFarmCreds } from '@/lib/meta-db';
import { DEFAULT_BUDGET_CAP_ZAR } from './defaults';

// ── Typed errors (silent-failure cure pattern) ────────────────────────────────

export type BudgetErrorCode =
  | 'EINSTEIN_BUDGET_EXHAUSTED'
  | 'EINSTEIN_BUDGET_FARM_NOT_FOUND'
  | 'EINSTEIN_BUDGET_SETTINGS_MISSING'
  | 'EINSTEIN_BUDGET_BAD_DELTA';

export class EinsteinBudgetError extends Error {
  readonly code: BudgetErrorCode;
  readonly resetsAt?: string;

  constructor(code: BudgetErrorCode, message: string, resetsAt?: string) {
    super(message);
    this.name = 'EinsteinBudgetError';
    this.code = code;
    this.resetsAt = resetsAt;
  }
}

export function currentMonthKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function firstOfNextMonthIso(d: Date): string {
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return next.toISOString();
}

// ── Internal: read the budget cap (still JSON) + volatile counter (columns) ────

/**
 * Shape of the FarmSettings row fields the budget module reads. The volatile
 * spend counter lives in dedicated columns (EIN-1); only the cap + kill-switch
 * remain in the `aiSettings` JSON blob.
 */
interface BudgetRow {
  aiSettings: string | null;
  aiBudgetMonthSpentZar: number | null;
  aiBudgetMonthKey: string | null;
}

/** Cap is the only budget value still parsed from the aiSettings JSON blob. */
function readBudgetCap(aiSettings: string | null): number {
  if (!aiSettings) return DEFAULT_BUDGET_CAP_ZAR;
  try {
    const parsed = JSON.parse(aiSettings) as {
      ragConfig?: { budgetCapZarPerMonth?: unknown };
    };
    const cap = parsed?.ragConfig?.budgetCapZarPerMonth;
    if (typeof cap === 'number' && Number.isFinite(cap) && cap > 0) return cap;
    return DEFAULT_BUDGET_CAP_ZAR;
  } catch {
    return DEFAULT_BUDGET_CAP_ZAR;
  }
}

/**
 * FarmSettings is a singleton per tenant DB — same pattern as every other
 * Phase J/K reader (findFirst, null-safe). Throws SETTINGS_MISSING when no row
 * exists so callers surface a typed error instead of silently defaulting.
 */
async function readBudgetRow(prisma: PrismaClient): Promise<BudgetRow> {
  const row = await prisma.farmSettings.findFirst({
    select: {
      aiSettings: true,
      aiBudgetMonthSpentZar: true,
      aiBudgetMonthKey: true,
    },
  });
  if (!row) {
    throw new EinsteinBudgetError(
      'EINSTEIN_BUDGET_SETTINGS_MISSING',
      'FarmSettings row not found for tenant',
    );
  }
  return row as BudgetRow;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check if the given farm has budget remaining for a query.
 *
 * Consulting tier short-circuits to `remainingZar: Infinity`.
 * Advanced tier rolls the monthly counter if the persisted aiBudgetMonthKey
 * doesn't match "today's" key (cron should handle this too — see
 * resetMonthlyBudget — but clients may race the cron so we also roll here).
 *
 * Throws EinsteinBudgetError with `code: 'EINSTEIN_BUDGET_EXHAUSTED'` when
 * the cap is already hit (UI shows the `resetsAt` ISO string to the user).
 */
export async function assertWithinBudget(
  farmSlug: string,
): Promise<{ tier: FarmTier; remainingZar: number }> {
  const creds = await getFarmCreds(farmSlug);
  if (!creds) {
    throw new EinsteinBudgetError(
      'EINSTEIN_BUDGET_FARM_NOT_FOUND',
      `Farm ${farmSlug} not found in meta DB`,
    );
  }
  const tier = creds.tier as FarmTier;

  // Consulting tier skips budget check entirely.
  if (isBudgetExempt(tier)) {
    return { tier, remainingZar: Number.POSITIVE_INFINITY };
  }

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    throw new EinsteinBudgetError(
      'EINSTEIN_BUDGET_FARM_NOT_FOUND',
      `Tenant DB for ${farmSlug} not reachable`,
    );
  }

  const row = await readBudgetRow(prisma);
  const cap = readBudgetCap(row.aiSettings);

  // Monthly rollover — if the stamped month key is stale, treat this request
  // as being in a fresh month with 0 spent. (Note: this is a read-time TOCTOU
  // window vs the atomic stamp, but the stamp itself self-heals the rollover.)
  const now = new Date();
  const thisMonth = currentMonthKey(now);
  const effectiveSpent =
    row.aiBudgetMonthKey === thisMonth ? row.aiBudgetMonthSpentZar ?? 0 : 0;
  const remainingZar = Math.max(0, cap - effectiveSpent);

  if (remainingZar <= 0) {
    throw new EinsteinBudgetError(
      'EINSTEIN_BUDGET_EXHAUSTED',
      `Farm Einstein has used its ZAR ${cap} monthly budget.`,
      firstOfNextMonthIso(now),
    );
  }

  return { tier, remainingZar };
}

/**
 * Guard: every atomic write targets the FarmSettings singleton. If 0 rows are
 * affected the tenant has no settings row — surface a typed error rather than
 * silently no-op'ing a debit.
 */
function assertRowsAffected(affected: number): void {
  if (affected < 1) {
    throw new EinsteinBudgetError(
      'EINSTEIN_BUDGET_SETTINGS_MISSING',
      'FarmSettings row not found for tenant',
    );
  }
}

/**
 * MARK-BEFORE-SEND: Stamp the estimated ZAR cost onto the counter BEFORE the
 * Anthropic call. After the call completes we patch with the actual cost via
 * reconcileCostAfterSend. This function is strictly the pessimistic pre-debit.
 *
 * ATOMIC (EIN-1): a single UPDATE statement handles month-rollover AND the
 * increment together. If the stored month key matches this month the counter
 * is incremented (`col + ?`); otherwise it RESETS to `estimatedCostZar` (the
 * stale prior month is discarded — correct rollover). Because the increment is
 * one statement, concurrent stamps compose instead of clobbering each other.
 */
export async function stampCostBeforeSend(
  farmSlug: string,
  estimatedCostZar: number,
): Promise<void> {
  if (estimatedCostZar < 0) {
    throw new EinsteinBudgetError(
      'EINSTEIN_BUDGET_EXHAUSTED',
      'estimatedCostZar must be non-negative',
    );
  }

  const creds = await getFarmCreds(farmSlug);
  if (!creds) {
    throw new EinsteinBudgetError(
      'EINSTEIN_BUDGET_FARM_NOT_FOUND',
      `Farm ${farmSlug} not found in meta DB`,
    );
  }
  // Consulting skips stamping too — no counter to track.
  if (isBudgetExempt(creds.tier as FarmTier)) return;

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    throw new EinsteinBudgetError(
      'EINSTEIN_BUDGET_FARM_NOT_FOUND',
      `Tenant DB for ${farmSlug} not reachable`,
    );
  }

  const thisMonth = currentMonthKey(new Date());
  const affected = await prisma.$executeRawUnsafe(
    `UPDATE "FarmSettings"
     SET "aiBudgetMonthSpentZar" = CASE WHEN "aiBudgetMonthKey" = ? THEN "aiBudgetMonthSpentZar" + ? ELSE ? END,
         "aiBudgetMonthKey" = ?
     WHERE "id" = 'singleton'`,
    thisMonth,
    estimatedCostZar,
    estimatedCostZar,
    thisMonth,
  );
  assertRowsAffected(affected);
}

/**
 * POST-SEND RECONCILIATION (api-F1/EIN-2): after the Anthropic call completes
 * the caller knows the REAL cost from returned usage; apply
 * `deltaZar = actual − pre-stamped estimate` so the monthly counter reflects
 * real consumption instead of the pessimistic guess. A negative delta credits
 * back the over-stamp; the counter clamps at 0.
 *
 * ATOMIC (EIN-1): same single-statement shape as stampCostBeforeSend, wrapped
 * in MAX(0, …) so a credit can never drive the counter negative. After a
 * rollover the reset value is `deltaZar`; a negative delta there clamps to 0.
 */
export async function reconcileCostAfterSend(
  farmSlug: string,
  deltaZar: number,
): Promise<void> {
  if (!Number.isFinite(deltaZar)) {
    throw new EinsteinBudgetError(
      'EINSTEIN_BUDGET_BAD_DELTA',
      'deltaZar must be a finite number',
    );
  }

  const creds = await getFarmCreds(farmSlug);
  if (!creds) {
    throw new EinsteinBudgetError(
      'EINSTEIN_BUDGET_FARM_NOT_FOUND',
      `Farm ${farmSlug} not found in meta DB`,
    );
  }
  // Consulting is budget-exempt — nothing was stamped, nothing to reconcile.
  if (isBudgetExempt(creds.tier as FarmTier)) return;

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    throw new EinsteinBudgetError(
      'EINSTEIN_BUDGET_FARM_NOT_FOUND',
      `Tenant DB for ${farmSlug} not reachable`,
    );
  }

  const thisMonth = currentMonthKey(new Date());
  const affected = await prisma.$executeRawUnsafe(
    `UPDATE "FarmSettings"
     SET "aiBudgetMonthSpentZar" = MAX(0, CASE WHEN "aiBudgetMonthKey" = ? THEN "aiBudgetMonthSpentZar" + ? ELSE ? END),
         "aiBudgetMonthKey" = ?
     WHERE "id" = 'singleton'`,
    thisMonth,
    deltaZar,
    deltaZar,
    thisMonth,
  );
  assertRowsAffected(affected);
}

/**
 * Inngest cron target: reset the monthly counter for a given tenant on the
 * first of each month. 2C's cron iterates all farms and calls this.
 * Idempotent — re-running mid-month just re-zeroes (harmless).
 */
export async function resetMonthlyBudget(farmSlug: string): Promise<void> {
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    throw new EinsteinBudgetError(
      'EINSTEIN_BUDGET_FARM_NOT_FOUND',
      `Tenant DB for ${farmSlug} not reachable`,
    );
  }
  const affected = await prisma.$executeRawUnsafe(
    `UPDATE "FarmSettings"
     SET "aiBudgetMonthSpentZar" = 0,
         "aiBudgetMonthKey" = ?
     WHERE "id" = 'singleton'`,
    currentMonthKey(new Date()),
  );
  assertRowsAffected(affected);
}
