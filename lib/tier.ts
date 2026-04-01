export type FarmTier = 'basic' | 'advanced';

// Routes locked for basic-tier farms
export const PREMIUM_ROUTES = new Set([
  'performance',
  'league',
  'reproduction',
  'finansies',
  'grafieke',
]);

export function isPremiumRoute(segment: string): boolean {
  return PREMIUM_ROUTES.has(segment);
}

export function isBasicTier(tier: string): boolean {
  return tier === 'basic';
}
