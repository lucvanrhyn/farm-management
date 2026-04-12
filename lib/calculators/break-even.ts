// Pure break-even feeder price calculator — no side effects, no imports.

export type FeedCostMode = 'daily_rate' | 'fcr';

export interface BreakEvenInputs {
  /** Purchase live mass in kg */
  purchaseMassKg: number;
  /** Purchase price in R per kg live mass */
  purchasePricePerKg: number;
  /** Target sell mass in kg */
  targetMassKg: number;
  /** Average daily gain in kg/day */
  adgKgPerDay: number;
  feedCostMode: FeedCostMode;
  /** Used when feedCostMode = 'daily_rate' */
  feedCostPerDay?: number;
  /** Feed conversion ratio (kg feed per kg gain) — used when feedCostMode = 'fcr' */
  fcr?: number;
  /** Feed price in R/kg — used when feedCostMode = 'fcr' */
  feedPricePerKg?: number;
  /** Transport to feedlot, R/animal */
  transportInPerAnimal: number;
  /** Transport to market/abattoir, R/animal */
  transportOutPerAnimal: number;
  /** Vet & medicine costs, R/animal */
  vetMedsPerAnimal: number;
  /**
   * Mortality rate as a percentage (e.g. 2 = 2%).
   * Applied as a loading on surviving-animal costs to account for dead-weight loss.
   */
  mortalityPercent: number;
  /** Fixed overhead allocated per animal (sheds, equipment depreciation, etc.) */
  fixedOverheadPerAnimal: number;
}

export interface FeedCostArgs {
  mode: FeedCostMode;
  /** Required for daily_rate mode */
  feedCostPerDay?: number;
  /** Required for daily_rate mode */
  days?: number;
  /** Required for fcr mode */
  fcr?: number;
  /** Required for fcr mode */
  feedPricePerKg?: number;
  /** Required for fcr mode */
  massGainKg?: number;
}

export interface CostBreakdown {
  daysOnFeed: number;
  massGainedKg: number;
  purchaseCostPerAnimal: number;
  totalFeedCostPerAnimal: number;
  transportCostPerAnimal: number;
  vetMedsCostPerAnimal: number;
  mortalityLoadingPerAnimal: number;
  fixedOverheadPerAnimal: number;
  totalVariableCostPerAnimal: number;
  totalCostPerAnimal: number;
  totalCostPerKgGained: number;
}

export interface BreakEvenPrice {
  margin: number;
  pricePerKg: number;
  pricePerAnimal: number;
}

export interface SensitivityCell {
  targetMass: number;
  marginPercent: number;
  pricePerKg: number;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Derives days on feed from mass targets and ADG.
 * Returns 0 when target ≤ purchase mass.
 */
export function calcDaysOnFeed(
  purchaseMassKg: number,
  targetMassKg: number,
  adgKgPerDay: number,
): number {
  const gain = targetMassKg - purchaseMassKg;
  if (gain <= 0) return 0;
  return gain / adgKgPerDay;
}

/**
 * Calculates total feed cost per animal.
 * Supports two modes: a flat daily rate, or FCR × feed price per kg.
 */
export function calcFeedCost(args: FeedCostArgs): number {
  if (args.mode === 'daily_rate') {
    if (args.feedCostPerDay == null || args.days == null) {
      throw new Error('daily_rate mode requires feedCostPerDay and days');
    }
    return args.feedCostPerDay * args.days;
  }

  // fcr mode
  if (args.fcr == null || args.feedPricePerKg == null || args.massGainKg == null) {
    throw new Error('fcr mode requires fcr, feedPricePerKg, and massGainKg');
  }
  return args.fcr * args.feedPricePerKg * args.massGainKg;
}

/**
 * Full cost breakdown for one animal from purchase through to sale.
 *
 * Mortality loading is applied to cover the cost of animals that die during the feeding
 * period — the surviving animals must each carry a share of the lost purchase investment.
 * Formula: cost_before_mortality × mortality_rate / (1 − mortality_rate)
 */
export function calcTotalCostPerAnimal(inputs: BreakEvenInputs): CostBreakdown {
  const {
    purchaseMassKg,
    purchasePricePerKg,
    targetMassKg,
    adgKgPerDay,
    feedCostMode,
    feedCostPerDay,
    fcr,
    feedPricePerKg,
    transportInPerAnimal,
    transportOutPerAnimal,
    vetMedsPerAnimal,
    mortalityPercent,
    fixedOverheadPerAnimal,
  } = inputs;

  const daysOnFeed = calcDaysOnFeed(purchaseMassKg, targetMassKg, adgKgPerDay);
  const massGainedKg = Math.max(0, targetMassKg - purchaseMassKg);

  const purchaseCostPerAnimal = purchaseMassKg * purchasePricePerKg;

  const totalFeedCostPerAnimal = calcFeedCost(
    feedCostMode === 'daily_rate'
      ? { mode: 'daily_rate', feedCostPerDay, days: daysOnFeed }
      : { mode: 'fcr', fcr, feedPricePerKg, massGainKg: massGainedKg },
  );

  const transportCostPerAnimal = transportInPerAnimal + transportOutPerAnimal;

  const costBeforeMortality =
    purchaseCostPerAnimal +
    totalFeedCostPerAnimal +
    transportCostPerAnimal +
    vetMedsPerAnimal;

  const mortalityRate = mortalityPercent / 100;
  const mortalityLoadingPerAnimal =
    mortalityRate > 0
      ? costBeforeMortality * (mortalityRate / (1 - mortalityRate))
      : 0;

  const totalVariableCostPerAnimal = costBeforeMortality + mortalityLoadingPerAnimal;
  const totalCostPerAnimal = totalVariableCostPerAnimal + fixedOverheadPerAnimal;
  const totalCostPerKgGained = massGainedKg > 0 ? totalCostPerAnimal / massGainedKg : 0;

  return {
    daysOnFeed,
    massGainedKg,
    purchaseCostPerAnimal,
    totalFeedCostPerAnimal,
    transportCostPerAnimal,
    vetMedsCostPerAnimal: vetMedsPerAnimal,
    mortalityLoadingPerAnimal,
    fixedOverheadPerAnimal,
    totalVariableCostPerAnimal,
    totalCostPerAnimal,
    totalCostPerKgGained,
  };
}

/**
 * Returns required sell prices at three margin targets (0%, 10%, 20%)
 * to cover total cost per animal at the given sell mass.
 */
export function calcBreakEvenPrices(
  totalCostPerAnimal: number,
  sellMassKg: number,
): BreakEvenPrice[] {
  return [0, 10, 20].map((margin) => {
    const pricePerAnimal = totalCostPerAnimal * (1 + margin / 100);
    return {
      margin,
      pricePerAnimal,
      pricePerKg: sellMassKg > 0 ? pricePerAnimal / sellMassKg : 0,
    };
  });
}

/**
 * Builds a 5×5 sensitivity table: rows = sell mass variants, columns = margin targets.
 *
 * Sell mass variants are spaced ±10% around the base target in 5% increments:
 * [−10%, −5%, 0%, +5%, +10%] of targetMassKg.
 *
 * Margin targets: [0%, 5%, 10%, 15%, 20%].
 */
export function calcSensitivityTable(
  totalCostPerAnimal: number,
  targetMassKg: number,
): SensitivityCell[][] {
  const massOffsets = [-0.1, -0.05, 0, 0.05, 0.1];
  const margins = [0, 5, 10, 15, 20];

  return massOffsets.map((offset) => {
    const mass = targetMassKg * (1 + offset);
    return margins.map((margin) => ({
      targetMass: Math.round(mass * 10) / 10,
      marginPercent: margin,
      pricePerKg: mass > 0 ? (totalCostPerAnimal * (1 + margin / 100)) / mass : 0,
    }));
  });
}
