// Pure veld-condition-scoring helpers — no side effects, no Prisma, no network.
// Encodes the DFFE Ecological Index Method (EIM) composite score and biome-based
// Long-Term Grazing Capacity (LTGC) lookup for SA rangeland.
//
// Research basis:
//   - DFFE Ecological Index Method (species composition, basal cover, erosion, bush encroachment)
//   - DFFE/AGIS LTGC norms per biome (ha/LSU at benchmark condition)
//   - Farmers Weekly practical 0–10 assessment scale

export type BiomeType = 'highveld' | 'bushveld' | 'lowveld' | 'karoo' | 'mixedveld';

export interface VeldInputs {
  /** Percentage of palatable (decreaser) grass species — 0..100. */
  readonly palatableSpeciesPct: number;
  /** Percentage of bare ground / no basal cover — 0..100. */
  readonly bareGroundPct: number;
  /** 0 = none, 1 = moderate, 2 = severe. */
  readonly erosionLevel: 0 | 1 | 2;
  /** 0 = sparse, 1 = moderate, 2 = dense. */
  readonly bushEncroachmentLevel: 0 | 1 | 2;
}

export interface GrazingCapacity {
  readonly haPerLsu: number | null;
  readonly lsuPerHa: number | null;
  readonly biomeBaseline: number;
}

export interface TrendPoint {
  readonly date: string; // YYYY-MM-DD
  readonly score: number;
}

/**
 * SA biome → benchmark LTGC at veld score 8 (ha per LSU).
 * Sources: DFFE/AGIS LTGC norms, SANBI rangeland atlas.
 *  - Highveld / temperate grassland: 4–6 ha/LSU (mid ≈ 5)
 *  - Bushveld / savanna: 10–15 ha/LSU (mid ≈ 12)
 *  - Lowveld: 8–12 ha/LSU (mid ≈ 10)
 *  - Karoo / Nama-karoo: 25–35 ha/LSU (mid ≈ 30)
 *  - Mixedveld fallback: 15 ha/LSU
 */
export const BIOME_LTGC_BASELINE: Readonly<Record<BiomeType, number>> = {
  highveld: 5,
  bushveld: 12,
  lowveld: 10,
  karoo: 30,
  mixedveld: 15,
};

const BENCHMARK_SCORE = 8;

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/**
 * Composite 0–10 veld score from four farmer-observable inputs.
 *
 * Formula (species composition as direct score, structural factors as deductions):
 *   score = clamp(
 *       10 * (palatable / 100)
 *     - (bareGround / 100) * 2.5
 *     - erosionLevel * 1.0
 *     - bushEncroachmentLevel * 0.75,
 *     0, 10
 *   )
 *
 * Design rationale (DFFE EIM alignment):
 *   - Palatable species % directly drives the 0–10 scale: 100% clean = 10, 0% = base 0.
 *   - Bare ground deducts up to 2.5 points (100% bare ground, typical worst case ≈ 2.5 pts off).
 *   - Severe erosion (level 2) deducts 2.0 points, reflecting structural soil loss.
 *   - Dense bush encroachment (level 2) deducts 1.5 points, reflecting reduced carrying capacity.
 *   - All deductions stack; result is clamped to [0, 10] and rounded to 1 dp.
 */
export function calcVeldScore(inputs: VeldInputs): number {
  const palatable = clamp(inputs.palatableSpeciesPct, 0, 100);
  const bareGround = clamp(inputs.bareGroundPct, 0, 100);
  const erosion = clamp(inputs.erosionLevel, 0, 2);
  const encroach = clamp(inputs.bushEncroachmentLevel, 0, 2);

  const raw =
    10 * (palatable / 100) - (bareGround / 100) * 2.5 - erosion * 1.0 - encroach * 0.75;

  return Number(clamp(raw, 0, 10).toFixed(1));
}

/**
 * Grazing capacity at the current veld score, given the farm's biome baseline.
 *
 * Formula: haPerLsu = baseline × (BENCHMARK_SCORE / score)
 *   - At score 8 (benchmark) you need exactly `baseline` ha per LSU.
 *   - At score 4 (half condition) you need 2× the area per LSU.
 *   - At score 0 the veld cannot support any stock (returns null).
 */
export function calcGrazingCapacity(biome: BiomeType, score: number): GrazingCapacity {
  const baseline = BIOME_LTGC_BASELINE[biome] ?? BIOME_LTGC_BASELINE.mixedveld;
  if (score <= 0) {
    return { haPerLsu: null, lsuPerHa: null, biomeBaseline: baseline };
  }
  const haPerLsu = Number((baseline * (BENCHMARK_SCORE / score)).toFixed(2));
  const lsuPerHa = Number((1 / haPerLsu).toFixed(4));
  return { haPerLsu, lsuPerHa, biomeBaseline: baseline };
}

/**
 * Linear least-squares slope of (score vs months elapsed), in score-points/month.
 * Robust to unsorted input. Returns 0 for <2 points or flat series.
 * Used by dashboard alerts to detect declining veld.
 */
export function calcTrendSlope(points: readonly TrendPoint[]): number {
  if (points.length < 2) return 0;

  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const anchor = new Date(sorted[0].date + 'T00:00:00Z').getTime();
  const monthsMs = 1000 * 60 * 60 * 24 * (365.25 / 12);

  const xs = sorted.map((p) => (new Date(p.date + 'T00:00:00Z').getTime() - anchor) / monthsMs);
  const ys = sorted.map((p) => p.score);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return 0;
  return Number((num / den).toFixed(4));
}

/**
 * Rest-day multiplier based on latest veld score:
 *   - score ≥ 7 (good):      1.0× (no change)
 *   - score 4..6.99 (fair):  1.3× (extend rest 30%)
 *   - score < 4 (poor):      1.6× (extend rest 60%, capped)
 *   - null (no data):        1.0× (no change)
 *
 * Called by the rotation engine after resolveEffectiveRestDays() computes the
 * seasonal baseline. Stacks multiplicatively with the seasonal multiplier.
 */
export function resolveRestDayModifier(veldScore: number | null): number {
  if (veldScore == null) return 1;
  if (veldScore >= 7) return 1;
  if (veldScore >= 4) return 1.3;
  return 1.6;
}
