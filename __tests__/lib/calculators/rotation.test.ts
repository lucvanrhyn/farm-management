import { describe, it, expect } from 'vitest';
import {
  VELD_TYPE_BASELINE,
  isGrowingSeasonMonth,
  resolveSeasonalMultiplier,
  resolveEffectiveRestDays,
  resolveEffectiveMaxGrazingDays,
  daysBetween,
  classifyCampStatus,
  calcCampLsuDays,
  rankNextToGraze,
  type RotationSettings,
  type CampRotationConfig,
  type RotationStatus,
} from '@/lib/calculators/rotation';

const SETTINGS: RotationSettings = {
  defaultRestDays: 60,
  defaultMaxGrazingDays: 7,
  rotationSeasonMode: 'auto',
  dormantSeasonMultiplier: 1.4,
};

const BLANK_CAMP: CampRotationConfig = {
  veldType: null,
  restDaysOverride: null,
  maxGrazingDaysOverride: null,
};

describe('isGrowingSeasonMonth', () => {
  it('returns true for Oct–Mar (SA summer-rainfall)', () => {
    for (const m of [10, 11, 12, 1, 2, 3]) {
      expect(isGrowingSeasonMonth(m)).toBe(true);
    }
  });

  it('returns false for Apr–Sep', () => {
    for (const m of [4, 5, 6, 7, 8, 9]) {
      expect(isGrowingSeasonMonth(m)).toBe(false);
    }
  });
});

describe('resolveSeasonalMultiplier', () => {
  it('returns 1.0 when forced growing mode', () => {
    const settings: RotationSettings = { ...SETTINGS, rotationSeasonMode: 'growing' };
    expect(resolveSeasonalMultiplier(settings, new Date('2026-07-01'))).toBe(1);
  });

  it('returns dormant multiplier when forced dormant mode', () => {
    const settings: RotationSettings = { ...SETTINGS, rotationSeasonMode: 'dormant' };
    expect(resolveSeasonalMultiplier(settings, new Date('2026-01-01'))).toBe(1.4);
  });

  it('auto uses calendar month — growing in December', () => {
    expect(resolveSeasonalMultiplier(SETTINGS, new Date('2026-12-15'))).toBe(1);
  });

  it('auto uses calendar month — dormant in June', () => {
    expect(resolveSeasonalMultiplier(SETTINGS, new Date('2026-06-15'))).toBe(1.4);
  });

  it('respects a custom dormant multiplier', () => {
    const settings: RotationSettings = { ...SETTINGS, dormantSeasonMultiplier: 1.75 };
    expect(resolveSeasonalMultiplier(settings, new Date('2026-05-01'))).toBe(1.75);
  });
});

describe('resolveEffectiveRestDays', () => {
  const growingSeason = new Date('2026-12-01');
  const dormantSeason = new Date('2026-06-01');

  it('uses farm default × seasonal multiplier when no override', () => {
    // growing: 60 × 1 = 60
    expect(resolveEffectiveRestDays(BLANK_CAMP, SETTINGS, growingSeason)).toBe(60);
    // dormant: 60 × 1.4 = 84
    expect(resolveEffectiveRestDays(BLANK_CAMP, SETTINGS, dormantSeason)).toBe(84);
  });

  it('camp override wins absolutely — no seasonal scaling', () => {
    const camp: CampRotationConfig = { ...BLANK_CAMP, restDaysOverride: 90 };
    expect(resolveEffectiveRestDays(camp, SETTINGS, dormantSeason)).toBe(90);
    expect(resolveEffectiveRestDays(camp, SETTINGS, growingSeason)).toBe(90);
  });

  it('respects farm default over veld-type baseline', () => {
    // Farm default is 60, sweetveld baseline is 75 — farm default wins.
    const camp: CampRotationConfig = { ...BLANK_CAMP, veldType: 'sweetveld' };
    expect(resolveEffectiveRestDays(camp, SETTINGS, growingSeason)).toBe(60);
  });

  it('rounds to whole days', () => {
    // 60 × 1.4 = 84 (clean); try a setting that doesn't divide evenly
    const settings: RotationSettings = { ...SETTINGS, defaultRestDays: 55 };
    // 55 × 1.4 = 77
    expect(resolveEffectiveRestDays(BLANK_CAMP, settings, dormantSeason)).toBe(77);
  });
});

describe('resolveEffectiveMaxGrazingDays', () => {
  it('uses farm default without override', () => {
    expect(resolveEffectiveMaxGrazingDays(BLANK_CAMP, SETTINGS)).toBe(7);
  });

  it('camp override wins', () => {
    const camp: CampRotationConfig = { ...BLANK_CAMP, maxGrazingDaysOverride: 14 };
    expect(resolveEffectiveMaxGrazingDays(camp, SETTINGS)).toBe(14);
  });
});

describe('daysBetween', () => {
  it('returns whole days between two dates', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-01-11T00:00:00Z');
    expect(daysBetween(start, end)).toBe(10);
  });

  it('returns 0 when end is before start', () => {
    const start = new Date('2026-01-10T00:00:00Z');
    const end = new Date('2026-01-01T00:00:00Z');
    expect(daysBetween(start, end)).toBe(0);
  });

  it('floors partial days', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-01-03T18:00:00Z');
    expect(daysBetween(start, end)).toBe(2);
  });
});

describe('classifyCampStatus', () => {
  const base = { effectiveMaxGrazingDays: 7, effectiveRestDays: 60 };

  it('occupied within window → grazing', () => {
    const status: RotationStatus = classifyCampStatus({
      ...base,
      isOccupied: true,
      daysGrazed: 3,
      daysRested: null,
    });
    expect(status).toBe('grazing');
  });

  it('occupied beyond window → overstayed', () => {
    const status: RotationStatus = classifyCampStatus({
      ...base,
      isOccupied: true,
      daysGrazed: 9,
      daysRested: null,
    });
    expect(status).toBe('overstayed');
  });

  it('occupied with null daysGrazed → grazing (not overstayed)', () => {
    expect(
      classifyCampStatus({
        ...base,
        isOccupied: true,
        daysGrazed: null,
        daysRested: null,
      }),
    ).toBe('grazing');
  });

  it('unoccupied, rested < target → resting', () => {
    expect(
      classifyCampStatus({
        ...base,
        isOccupied: false,
        daysGrazed: null,
        daysRested: 30,
      }),
    ).toBe('resting');
  });

  it('unoccupied, rested = target → resting_ready', () => {
    expect(
      classifyCampStatus({
        ...base,
        isOccupied: false,
        daysGrazed: null,
        daysRested: 60,
      }),
    ).toBe('resting_ready');
  });

  it('unoccupied, rested >> target → overdue_rest', () => {
    expect(
      classifyCampStatus({
        ...base,
        isOccupied: false,
        daysGrazed: null,
        daysRested: 130,
      }),
    ).toBe('overdue_rest');
  });

  it('unoccupied, rested at exactly 2× target → overdue_rest (boundary)', () => {
    expect(
      classifyCampStatus({
        ...base,
        isOccupied: false,
        daysGrazed: null,
        daysRested: 120, // exactly 60 × 2
      }),
    ).toBe('overdue_rest');
  });

  it('unoccupied, rested at 2× target minus 1 → resting_ready (boundary)', () => {
    expect(
      classifyCampStatus({
        ...base,
        isOccupied: false,
        daysGrazed: null,
        daysRested: 119,
      }),
    ).toBe('resting_ready');
  });

  it('unoccupied with no rest history → unknown', () => {
    expect(
      classifyCampStatus({
        ...base,
        isOccupied: false,
        daysGrazed: null,
        daysRested: null,
      }),
    ).toBe('unknown');
  });

  it('occupied daysGrazed exactly at max is still grazing', () => {
    expect(
      classifyCampStatus({
        ...base,
        isOccupied: true,
        daysGrazed: 7,
        daysRested: null,
      }),
    ).toBe('grazing');
  });
});

describe('calcCampLsuDays', () => {
  it('computes forage-days of capacity', () => {
    // 1200 kg DM/ha × 0.35 × 10 ha = 4200 kg DM; ÷ 10 kg/LSU/day = 420 LSU-days
    expect(calcCampLsuDays(1200, 0.35, 10)).toBe(420);
  });

  it('returns null on missing inputs', () => {
    expect(calcCampLsuDays(null, 0.35, 10)).toBeNull();
    expect(calcCampLsuDays(1200, null, 10)).toBeNull();
    expect(calcCampLsuDays(1200, 0.35, null)).toBeNull();
  });

  it('returns null on zero or negative size', () => {
    expect(calcCampLsuDays(1200, 0.35, 0)).toBeNull();
    expect(calcCampLsuDays(1200, 0.35, -5)).toBeNull();
  });

  it('returns null on zero kgDmPerHa', () => {
    expect(calcCampLsuDays(0, 0.35, 10)).toBeNull();
  });

  it('returns null on zero useFactor', () => {
    expect(calcCampLsuDays(1200, 0, 10)).toBeNull();
  });

  it('returns null on negative useFactor', () => {
    expect(calcCampLsuDays(1200, -0.1, 10)).toBeNull();
  });
});

describe('rankNextToGraze', () => {
  const camps = [
    { campId: 'A', status: 'resting_ready' as RotationStatus, daysRested: 65, capacityLsuDays: 300 },
    { campId: 'B', status: 'grazing' as RotationStatus, daysRested: null, capacityLsuDays: 200 },
    { campId: 'C', status: 'resting_ready' as RotationStatus, daysRested: 80, capacityLsuDays: 150 },
    { campId: 'D', status: 'overdue_rest' as RotationStatus, daysRested: 130, capacityLsuDays: 250 },
    { campId: 'E', status: 'resting' as RotationStatus, daysRested: 30, capacityLsuDays: 400 },
  ];

  it('keeps only resting_ready + overdue_rest camps', () => {
    const out = rankNextToGraze(camps).map((c) => c.campId);
    expect(out).toEqual(['D', 'C', 'A']);
  });

  it('overdue_rest comes first', () => {
    const out = rankNextToGraze(camps);
    expect(out[0].campId).toBe('D');
  });

  it('ties break on days rested desc', () => {
    const out = rankNextToGraze(camps);
    expect(out[1].campId).toBe('C'); // 80d vs 65d
    expect(out[2].campId).toBe('A');
  });

  it('returns empty when nothing is ready', () => {
    expect(
      rankNextToGraze([
        { campId: 'X', status: 'grazing', daysRested: null, capacityLsuDays: 100 },
        { campId: 'Y', status: 'resting', daysRested: 30, capacityLsuDays: 100 },
      ]),
    ).toEqual([]);
  });

  it('breaks daysRested tie on capacityLsuDays desc', () => {
    const tied = [
      { campId: 'P', status: 'resting_ready' as RotationStatus, daysRested: 70, capacityLsuDays: 100 },
      { campId: 'Q', status: 'resting_ready' as RotationStatus, daysRested: 70, capacityLsuDays: 400 },
    ];
    const out = rankNextToGraze(tied).map((c) => c.campId);
    expect(out).toEqual(['Q', 'P']); // higher capacity first
  });
});

describe('VELD_TYPE_BASELINE', () => {
  it('exposes baseline for every veld type', () => {
    expect(VELD_TYPE_BASELINE.sweetveld).toBe(75);
    expect(VELD_TYPE_BASELINE.sourveld).toBe(50);
    expect(VELD_TYPE_BASELINE.mixedveld).toBe(60);
    expect(VELD_TYPE_BASELINE.cultivated).toBe(30);
  });
});

describe('resolveEffectiveRestDays with veld score', () => {
  const baseSettings: RotationSettings = {
    defaultRestDays: 60,
    defaultMaxGrazingDays: 7,
    rotationSeasonMode: 'growing',
    dormantSeasonMultiplier: 1.4,
  };
  const camp: CampRotationConfig = {
    veldType: 'mixedveld',
    restDaysOverride: null,
    maxGrazingDaysOverride: null,
  };
  const now = new Date('2026-01-15T00:00:00Z');

  it('returns 60 with no veld score', () => {
    expect(resolveEffectiveRestDays(camp, baseSettings, now, null)).toBe(60);
  });

  it('returns 60 for score 8 (good)', () => {
    expect(resolveEffectiveRestDays(camp, baseSettings, now, 8)).toBe(60);
  });

  it('extends to 78 for score 5 (fair, 1.3×)', () => {
    expect(resolveEffectiveRestDays(camp, baseSettings, now, 5)).toBe(78);
  });

  it('extends to 96 for score 2 (poor, 1.6×)', () => {
    expect(resolveEffectiveRestDays(camp, baseSettings, now, 2)).toBe(96);
  });

  it('override bypasses veld modifier entirely', () => {
    const override: CampRotationConfig = { ...camp, restDaysOverride: 45 };
    expect(resolveEffectiveRestDays(override, baseSettings, now, 2)).toBe(45);
  });
});
