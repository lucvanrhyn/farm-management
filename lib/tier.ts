/**
 * FarmTier — authoritative tier union.
 *
 * Phase L (2026-04-20): extended from `'basic' | 'advanced'` to include
 * `'consulting'`. Required for the Consulting-tier unlimited-budget
 * exemption on Farm Einstein. Also unblocks future Workstream D CRM tier
 * alignment and cleaner server-side tier checks.
 *
 * When comparing tiers for gating:
 *   - Basic: no Einstein, no map moat layers, no advanced features
 *   - Advanced: all features, budget-capped where applicable (ZAR 100/mo Einstein)
 *   - Consulting: all features, budget-exempt, bespoke support
 *
 * Server-side pattern:
 *   const tier: FarmTier = (creds?.tier as FarmTier) ?? 'basic';
 *   const isPaid = tier === 'advanced' || tier === 'consulting';
 *   const isUnlimited = tier === 'consulting';
 */
export type FarmTier = 'basic' | 'advanced' | 'consulting';

/** Tiers that unlock premium features (Advanced + Consulting). */
export const PAID_TIERS: ReadonlyArray<FarmTier> = ['advanced', 'consulting'];

/** Tiers that are exempt from per-tenant budget caps. */
export const BUDGET_EXEMPT_TIERS: ReadonlyArray<FarmTier> = ['consulting'];

export function isPaidTier(tier: FarmTier | string | undefined | null): boolean {
  return tier === 'advanced' || tier === 'consulting';
}

export function isBudgetExempt(tier: FarmTier | string | undefined | null): boolean {
  return tier === 'consulting';
}
