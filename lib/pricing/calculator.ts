import { PRICING, type SelfServeTier } from './constants';

export type TierQuote = {
  tier: SelfServeTier;
  lsu: number;
  annualZar: number;
  monthlyZar: number;
  annualFormatted: string;
  monthlyFormatted: string;
};

function assertValidLsu(lsu: number): void {
  if (!Number.isFinite(lsu)) throw new Error('LSU must be finite');
  if (lsu < 0) throw new Error('LSU must be non-negative');
  if (!Number.isInteger(lsu)) throw new Error('LSU must be an integer');
}

/**
 * Annual ZAR for a tier at the given LSU. Rounded to the nearest rand
 * exactly once (Math.round). Downstream code should persist this value
 * as-is and avoid re-rounding to prevent drift.
 */
export function computeAnnual(tier: SelfServeTier, lsu: number): number {
  assertValidLsu(lsu);
  const t = PRICING[tier];
  return Math.round(t.baseAnnual + t.perLsuAnnual * lsu);
}

export function computeMonthlyFromAnnual(annualZar: number): number {
  return Math.round((annualZar * PRICING.monthlyPremium) / 12);
}

/**
 * Formats a ZAR amount as "R<amount>" with comma thousand separators
 * (e.g. R11,000). Uses en-US locale because Node's en-ZA renders
 * thousands with a non-breaking space ("R11 000"), which is incorrect
 * for our marketing/UI conventions and unstable across ICU versions.
 *
 * Note: this relies on Node's ICU returning `R11,000` with en-US. If
 * this module is ever bundled client-side, verify `Intl.NumberFormat`
 * produces the same output in target browsers — browser ICU data may
 * differ from Node's and could break formatting.
 */
export function formatZar(zar: number): string {
  return `R${zar.toLocaleString('en-US')}`;
}

export function quoteTier(tier: SelfServeTier, lsu: number): TierQuote {
  assertValidLsu(lsu);
  const annualZar = computeAnnual(tier, lsu);
  const monthlyZar = computeMonthlyFromAnnual(annualZar);
  return {
    tier,
    lsu,
    annualZar,
    monthlyZar,
    annualFormatted: formatZar(annualZar),
    monthlyFormatted: formatZar(monthlyZar),
  };
}
