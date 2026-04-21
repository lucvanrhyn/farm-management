/**
 * @vitest-environment node
 *
 * __tests__/einstein/budget.test.ts — Phase L Wave 2B budget module.
 *
 * Covered behaviours:
 *   - consulting tier → skips check, returns Infinity
 *   - advanced tier at cap → throws EINSTEIN_BUDGET_EXHAUSTED
 *   - advanced tier below cap → returns remaining ZAR
 *   - monthly rollover — stale currentMonthKey resets the counter
 *   - stampCostBeforeSend fires UPDATE before caller proceeds (ordering captured
 *     via a call-order array mock)
 *   - stampCostBeforeSend short-circuits for consulting
 *   - resetMonthlyBudget writes zeroes and the current month key
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const getFarmCredsMock = vi.fn();
const getPrismaForFarmMock = vi.fn();

vi.mock('@/lib/meta-db', () => ({
  getFarmCreds: (...args: unknown[]) => getFarmCredsMock(...args),
}));

vi.mock('@/lib/farm-prisma', () => ({
  getPrismaForFarm: (...args: unknown[]) => getPrismaForFarmMock(...args),
}));

// Imports AFTER mocks so the module-under-test receives our doubles.
const budgetMod = await import('@/lib/einstein/budget');

const {
  assertWithinBudget,
  stampCostBeforeSend,
  resetMonthlyBudget,
  EinsteinBudgetError,
  currentMonthKey,
} = budgetMod;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFakePrisma(
  aiSettings: Record<string, unknown> | null,
  sideEffects: { updateManyCalls?: unknown[] } = {},
) {
  const farmSettingsFindFirst = vi.fn().mockResolvedValue(
    aiSettings === null
      ? { aiSettings: null }
      : { aiSettings: JSON.stringify(aiSettings) },
  );
  const farmSettingsUpdateMany = vi.fn().mockImplementation((args: unknown) => {
    if (sideEffects.updateManyCalls) sideEffects.updateManyCalls.push(args);
    return Promise.resolve({ count: 1 });
  });
  return {
    farmSettings: {
      findFirst: farmSettingsFindFirst,
      updateMany: farmSettingsUpdateMany,
    },
  };
}

function mkRagConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    budgetCapZarPerMonth: 100,
    monthSpentZar: 0,
    currentMonthKey: currentMonthKey(new Date()),
    ...overrides,
  };
}

beforeEach(() => {
  getFarmCredsMock.mockReset();
  getPrismaForFarmMock.mockReset();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('assertWithinBudget', () => {
  it('consulting tier short-circuits to Infinity without touching Prisma', async () => {
    getFarmCredsMock.mockResolvedValue({
      tursoUrl: 'x',
      tursoAuthToken: 'y',
      tier: 'consulting',
    });
    const result = await assertWithinBudget('mega-farm');
    expect(result.tier).toBe('consulting');
    expect(result.remainingZar).toBe(Number.POSITIVE_INFINITY);
    expect(getPrismaForFarmMock).not.toHaveBeenCalled();
  });

  it('advanced tier below cap returns remaining ZAR', async () => {
    getFarmCredsMock.mockResolvedValue({
      tursoUrl: 'x',
      tursoAuthToken: 'y',
      tier: 'advanced',
    });
    const fake = makeFakePrisma({
      ragConfig: mkRagConfig({ monthSpentZar: 40 }),
    });
    getPrismaForFarmMock.mockResolvedValue(fake);
    const result = await assertWithinBudget('trio-b-boerdery');
    expect(result.tier).toBe('advanced');
    expect(result.remainingZar).toBe(60);
  });

  it('advanced tier at cap throws EINSTEIN_BUDGET_EXHAUSTED', async () => {
    getFarmCredsMock.mockResolvedValue({
      tursoUrl: 'x',
      tursoAuthToken: 'y',
      tier: 'advanced',
    });
    const fake = makeFakePrisma({
      ragConfig: mkRagConfig({ monthSpentZar: 100 }),
    });
    getPrismaForFarmMock.mockResolvedValue(fake);
    try {
      await assertWithinBudget('trio-b-boerdery');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EinsteinBudgetError);
      expect((err as InstanceType<typeof EinsteinBudgetError>).code).toBe(
        'EINSTEIN_BUDGET_EXHAUSTED',
      );
      expect((err as InstanceType<typeof EinsteinBudgetError>).resetsAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T/,
      );
    }
  });

  it('advanced tier over cap throws EINSTEIN_BUDGET_EXHAUSTED', async () => {
    getFarmCredsMock.mockResolvedValue({
      tursoUrl: 'x',
      tursoAuthToken: 'y',
      tier: 'advanced',
    });
    const fake = makeFakePrisma({
      ragConfig: mkRagConfig({ monthSpentZar: 150 }),
    });
    getPrismaForFarmMock.mockResolvedValue(fake);
    await expect(assertWithinBudget('trio-b-boerdery')).rejects.toBeInstanceOf(
      EinsteinBudgetError,
    );
  });

  it('stale currentMonthKey rolls over — advanced tier treated as 0 spent', async () => {
    getFarmCredsMock.mockResolvedValue({
      tursoUrl: 'x',
      tursoAuthToken: 'y',
      tier: 'advanced',
    });
    const fake = makeFakePrisma({
      ragConfig: mkRagConfig({
        monthSpentZar: 500,
        currentMonthKey: '1999-01', // stale
      }),
    });
    getPrismaForFarmMock.mockResolvedValue(fake);
    const result = await assertWithinBudget('trio-b-boerdery');
    // Cap 100 - 0 = 100 remaining because prior month's 500 is ignored.
    expect(result.remainingZar).toBe(100);
  });

  it('missing ragConfig blob defaults to full budget', async () => {
    getFarmCredsMock.mockResolvedValue({
      tursoUrl: 'x',
      tursoAuthToken: 'y',
      tier: 'advanced',
    });
    const fake = makeFakePrisma({}); // no ragConfig present
    getPrismaForFarmMock.mockResolvedValue(fake);
    const result = await assertWithinBudget('trio-b-boerdery');
    expect(result.remainingZar).toBe(100);
  });

  it('farm not found in meta DB throws typed error', async () => {
    getFarmCredsMock.mockResolvedValue(null);
    await expect(assertWithinBudget('no-such')).rejects.toBeInstanceOf(EinsteinBudgetError);
  });
});

describe('stampCostBeforeSend — mark-before-send ordering', () => {
  it('consulting tier returns without writing', async () => {
    getFarmCredsMock.mockResolvedValue({
      tursoUrl: 'x',
      tursoAuthToken: 'y',
      tier: 'consulting',
    });
    await stampCostBeforeSend('mega-farm', 5);
    expect(getPrismaForFarmMock).not.toHaveBeenCalled();
  });

  it('advanced tier writes updated monthSpentZar BEFORE caller proceeds', async () => {
    getFarmCredsMock.mockResolvedValue({
      tursoUrl: 'x',
      tursoAuthToken: 'y',
      tier: 'advanced',
    });
    const updateManyCalls: unknown[] = [];
    const callOrder: string[] = [];

    const prismaObj = {
      farmSettings: {
        findFirst: vi.fn().mockImplementation(() => {
          callOrder.push('findFirst');
          return Promise.resolve({
            aiSettings: JSON.stringify({ ragConfig: mkRagConfig({ monthSpentZar: 10 }) }),
          });
        }),
        updateMany: vi.fn().mockImplementation((args: unknown) => {
          callOrder.push('updateMany');
          updateManyCalls.push(args);
          return Promise.resolve({ count: 1 });
        }),
      },
    };
    getPrismaForFarmMock.mockResolvedValue(prismaObj);

    // Simulate caller pattern: stamp, then fake-Anthropic call.
    const anthropicCalls: string[] = [];
    await stampCostBeforeSend('trio-b-boerdery', 3);
    anthropicCalls.push('anthropic-api');

    // Assert stamp ran BEFORE caller would invoke Anthropic.
    expect(callOrder).toEqual(['findFirst', 'updateMany']);
    // The stamped call precedes the anthropic simulated call by program order:
    expect(anthropicCalls.length).toBe(1);
    expect(updateManyCalls).toHaveLength(1);

    const stamped = updateManyCalls[0] as { data: { aiSettings: string } };
    const parsed = JSON.parse(stamped.data.aiSettings) as { ragConfig: { monthSpentZar: number } };
    expect(parsed.ragConfig.monthSpentZar).toBeCloseTo(13, 5);
  });

  it('rejects negative estimatedCostZar', async () => {
    await expect(stampCostBeforeSend('x', -1)).rejects.toBeInstanceOf(EinsteinBudgetError);
  });

  it('resets counter on monthly rollover (stale key → new month key stamped)', async () => {
    getFarmCredsMock.mockResolvedValue({
      tursoUrl: 'x',
      tursoAuthToken: 'y',
      tier: 'advanced',
    });
    const updateManyCalls: unknown[] = [];
    const fake = makeFakePrisma(
      { ragConfig: mkRagConfig({ monthSpentZar: 99, currentMonthKey: '1999-01' }) },
      { updateManyCalls },
    );
    getPrismaForFarmMock.mockResolvedValue(fake);

    await stampCostBeforeSend('trio-b-boerdery', 5);
    const stamped = updateManyCalls[0] as { data: { aiSettings: string } };
    const parsed = JSON.parse(stamped.data.aiSettings) as {
      ragConfig: { monthSpentZar: number; currentMonthKey: string };
    };
    // Stale 99 ZAR discarded; new spend starts at 5.
    expect(parsed.ragConfig.monthSpentZar).toBeCloseTo(5, 5);
    expect(parsed.ragConfig.currentMonthKey).toBe(currentMonthKey(new Date()));
  });
});

describe('resetMonthlyBudget', () => {
  it('writes a fresh ragConfig with 0 spent + current month key', async () => {
    const updateManyCalls: unknown[] = [];
    const fake = makeFakePrisma(
      { ragConfig: mkRagConfig({ monthSpentZar: 88 }) },
      { updateManyCalls },
    );
    getPrismaForFarmMock.mockResolvedValue(fake);
    await resetMonthlyBudget('trio-b-boerdery');
    const stamped = updateManyCalls[0] as { data: { aiSettings: string } };
    const parsed = JSON.parse(stamped.data.aiSettings) as {
      ragConfig: { monthSpentZar: number; currentMonthKey: string };
    };
    expect(parsed.ragConfig.monthSpentZar).toBe(0);
    expect(parsed.ragConfig.currentMonthKey).toBe(currentMonthKey(new Date()));
  });
});
