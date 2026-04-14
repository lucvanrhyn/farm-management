export const PRICING = {
  basic: {
    baseAnnual: 1800,   // ZAR
    perLsuAnnual: 0.75, // ZAR
  },
  advanced: {
    baseAnnual: 3000,
    perLsuAnnual: 10,
  },
  monthlyPremium: 1.2,
  currency: 'ZAR' as const,
} as const;

export type SelfServeTier = 'basic' | 'advanced';
