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
 * Storage: aiSettings JSON blob on FarmSettings (per Wave 1 schema):
 *   {
 *     ragConfig: {
 *       enabled: boolean,
 *       budgetCapZarPerMonth: number,
 *       monthSpentZar: number,
 *       currentMonthKey: string  // "YYYY-MM"
 *     }
 *   }
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
  | 'EINSTEIN_BUDGET_SETTINGS_MISSING';

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

// ── Shape of the ragConfig blob ───────────────────────────────────────────────

export interface RagConfig {
  enabled: boolean;
  budgetCapZarPerMonth: number;
  monthSpentZar: number;
  currentMonthKey: string;
}

function defaultRagConfig(): RagConfig {
  return {
    enabled: true,
    budgetCapZarPerMonth: DEFAULT_BUDGET_CAP_ZAR,
    monthSpentZar: 0,
    currentMonthKey: currentMonthKey(new Date()),
  };
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

// ── Internal: read/write aiSettings ──────────────────────────────────────────

interface AiSettingsBlob {
  assistantName?: string;
  responseLanguage?: string;
  methodology?: unknown;
  ragConfig?: RagConfig;
  learnedPreferences?: unknown;
}

async function readAiSettings(prisma: PrismaClient): Promise<AiSettingsBlob> {
  // FarmSettings is a singleton per tenant DB — same pattern as every other
  // Phase J/K generator (findFirst, null-safe default).
  // Prisma client is loose-typed here; cast via any to tolerate the newly-added
  // aiSettings column on tenant DBs that may not yet have regenerated types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (prisma as any).farmSettings.findFirst({});
  if (!row) {
    throw new EinsteinBudgetError(
      'EINSTEIN_BUDGET_SETTINGS_MISSING',
      'FarmSettings row not found for tenant',
    );
  }
  const raw = row.aiSettings as string | null | undefined;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as AiSettingsBlob;
  } catch {
    return {};
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check if the given farm has budget remaining for a query.
 *
 * Consulting tier short-circuits to `remainingZar: Infinity`.
 * Advanced tier rolls the monthly counter if the persisted currentMonthKey
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

  const settings = await readAiSettings(prisma);
  const rag = settings.ragConfig ?? defaultRagConfig();

  // Monthly rollover — if the stamped currentMonthKey is stale, treat this
  // request as being in a fresh month with 0 spent.
  const now = new Date();
  const thisMonth = currentMonthKey(now);
  const effectiveSpent = rag.currentMonthKey === thisMonth ? rag.monthSpentZar : 0;
  const cap = rag.budgetCapZarPerMonth ?? DEFAULT_BUDGET_CAP_ZAR;
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
 * MARK-BEFORE-SEND: Stamp the estimated ZAR cost onto the counter BEFORE the
 * Anthropic call. After the call completes we can patch with the actual cost
 * (delta = actual - estimated) via a separate adjustment, but that's the
 * caller's responsibility. This function is strictly the pessimistic pre-debit.
 *
 * Idempotent on monthly rollover: if currentMonthKey is stale the counter
 * resets to `estimatedCostZar` (not added on top of last month).
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

  const settings = await readAiSettings(prisma);
  const rag = settings.ragConfig ?? defaultRagConfig();
  const now = new Date();
  const thisMonth = currentMonthKey(now);
  const rolledOver = rag.currentMonthKey !== thisMonth;

  const next: RagConfig = {
    enabled: rag.enabled ?? true,
    budgetCapZarPerMonth: rag.budgetCapZarPerMonth ?? DEFAULT_BUDGET_CAP_ZAR,
    monthSpentZar: (rolledOver ? 0 : rag.monthSpentZar) + estimatedCostZar,
    currentMonthKey: thisMonth,
  };
  const nextBlob: AiSettingsBlob = { ...settings, ragConfig: next };

  // Atomic write of the whole aiSettings blob. We deliberately avoid
  // json_set() here — the column is a plain String, not SQLite JSON1
  // functions. Rewriting the whole blob is O(few-KB) and avoids edge cases
  // where the blob was null or malformed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).farmSettings.updateMany({
    data: { aiSettings: JSON.stringify(nextBlob) },
  });
}

/**
 * Inngest cron target: reset the monthly counter for a given tenant on the
 * first of each month. 2C's cron iterates all farms and calls this.
 * Idempotent — if called mid-month with matching currentMonthKey it's a no-op
 * (still writes the same blob back; harmless).
 */
export async function resetMonthlyBudget(farmSlug: string): Promise<void> {
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    throw new EinsteinBudgetError(
      'EINSTEIN_BUDGET_FARM_NOT_FOUND',
      `Tenant DB for ${farmSlug} not reachable`,
    );
  }
  const settings = await readAiSettings(prisma);
  const rag = settings.ragConfig ?? defaultRagConfig();
  const next: RagConfig = {
    ...rag,
    monthSpentZar: 0,
    currentMonthKey: currentMonthKey(new Date()),
  };
  const nextBlob: AiSettingsBlob = { ...settings, ragConfig: next };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).farmSettings.updateMany({
    data: { aiSettings: JSON.stringify(nextBlob) },
  });
}
