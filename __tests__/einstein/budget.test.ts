/**
 * @vitest-environment node
 *
 * __tests__/einstein/budget.test.ts — Phase L Wave 2B budget module.
 *
 * Covered behaviours:
 *   - consulting tier → skips check, returns Infinity
 *   - advanced tier at cap → throws EINSTEIN_BUDGET_EXHAUSTED
 *   - advanced tier below cap → returns remaining ZAR
 *   - monthly rollover — stale aiBudgetMonthKey resets the counter
 *   - stampCostBeforeSend fires the atomic UPDATE before caller proceeds
 *   - stampCostBeforeSend short-circuits for consulting
 *   - resetMonthlyBudget zeroes the counter + writes the current month key
 *
 * EIN-1 (slice S23): the volatile spend counter moved out of the aiSettings
 * JSON blob into dedicated columns (FarmSettings.aiBudgetMonthSpentZar +
 * aiBudgetMonthKey) so the three writers can use single-statement atomic SQL
 * (`UPDATE … SET col = col + ?`) instead of a lost-update-prone
 * read-modify-write of the whole JSON blob. The fake Prisma below models
 * `$executeRawUnsafe` as an atomic, serialized increment so the concurrency
 * test genuinely exercises the no-lost-update guarantee.
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

  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

// Imports AFTER mocks so the module-under-test receives our doubles.
const budgetMod = await import('@/lib/einstein/budget');

const {
  assertWithinBudget,
  stampCostBeforeSend,
  reconcileCostAfterSend,
  resetMonthlyBudget,
  EinsteinBudgetError,
  currentMonthKey,
} = budgetMod;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Stateful in-memory FarmSettings singleton.
 *
 * `$executeRawUnsafe` interprets the three atomic statements the budget module
 * emits and applies them to `row` ATOMICALLY: it captures the pre-state, awaits
 * a microtask (to interleave with other concurrent calls), then commits the new
 * value derived from the value it read at call-entry serialized through a tiny
 * lock. This faithfully models a single-statement SQL UPDATE — concurrent calls
 * cannot lose each other's increments. (A read-modify-write fake — read then
 * write in separate awaits without the lock — WOULD lose updates; that is the
 * exact bug EIN-1 fixes, so the lock is what makes this test honest.)
 */
function makeAtomicPrisma(initial: {
  aiBudgetMonthSpentZar?: number;
  aiBudgetMonthKey?: string | null;
  aiSettings?: Record<string, unknown> | null;
}) {
  const row = {
    id: 'singleton',
    aiBudgetMonthSpentZar: initial.aiBudgetMonthSpentZar ?? 0,
    aiBudgetMonthKey: initial.aiBudgetMonthKey ?? null,
    aiSettings:
      initial.aiSettings === undefined || initial.aiSettings === null
        ? null
        : JSON.stringify(initial.aiSettings),
  };

  // Serializes the apply step so an UPDATE behaves as a single atomic statement.
  let lock: Promise<void> = Promise.resolve();
  const executeCalls: Array<{ sql: string; args: unknown[] }> = [];

  function applyAtomic(sql: string, args: unknown[]): Promise<number> {
    const run = lock.then(async () => {
      // Yield once so concurrent callers interleave at the await boundary —
      // this is where a non-atomic read-modify-write fake would lose updates.
      await Promise.resolve();
      const norm = sql.replace(/\s+/g, ' ').trim();

      if (norm.startsWith('UPDATE "FarmSettings"') && norm.includes('CASE WHEN')) {
        // stamp / reconcile: params are [monthKey, delta, resetValue, monthKey]
        const [monthKey, delta, resetValue, newKey] = args as [
          string,
          number,
          number,
          string,
        ];
        const base =
          row.aiBudgetMonthKey === monthKey
            ? row.aiBudgetMonthSpentZar + delta
            : resetValue;
        const clamped = norm.includes('MAX(0,') ? Math.max(0, base) : base;
        row.aiBudgetMonthSpentZar = clamped;
        row.aiBudgetMonthKey = newKey;
        return 1;
      }

      if (norm.includes('"aiBudgetMonthSpentZar" = 0')) {
        // resetMonthlyBudget: params are [monthKey]
        const [monthKey] = args as [string];
        row.aiBudgetMonthSpentZar = 0;
        row.aiBudgetMonthKey = monthKey;
        return 1;
      }

      throw new Error(`unexpected SQL in fake: ${norm}`);
    });
    lock = run.then(() => undefined).catch(() => undefined);
    return run;
  }

  const client = {
    row, // exposed for assertions
    executeCalls,
    farmSettings: {
      findFirst: vi.fn().mockImplementation(() => Promise.resolve({ ...row })),
    },
    $executeRawUnsafe: vi.fn().mockImplementation((sql: string, ...args: unknown[]) => {
      executeCalls.push({ sql, args });
      return applyAtomic(sql, args);
    }),
  };
  return client;
}

beforeEach(() => {
  getFarmCredsMock.mockReset();
  getPrismaForFarmMock.mockReset();
});

function advancedCreds() {
  getFarmCredsMock.mockResolvedValue({
    tursoUrl: 'x',
    tursoAuthToken: 'y',
    tier: 'advanced',
  });
}

function ragWithCap(cap = 100): Record<string, unknown> {
  return { ragConfig: { enabled: true, budgetCapZarPerMonth: cap } };
}

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

  it('advanced tier below cap returns remaining ZAR (spent read from column)', async () => {
    advancedCreds();
    const fake = makeAtomicPrisma({
      aiBudgetMonthSpentZar: 40,
      aiBudgetMonthKey: currentMonthKey(new Date()),
      aiSettings: ragWithCap(100),
    });
    getPrismaForFarmMock.mockResolvedValue(fake);
    const result = await assertWithinBudget('delta-livestock');
    expect(result.tier).toBe('advanced');
    expect(result.remainingZar).toBe(60);
  });

  it('advanced tier at cap throws EINSTEIN_BUDGET_EXHAUSTED', async () => {
    advancedCreds();
    const fake = makeAtomicPrisma({
      aiBudgetMonthSpentZar: 100,
      aiBudgetMonthKey: currentMonthKey(new Date()),
      aiSettings: ragWithCap(100),
    });
    getPrismaForFarmMock.mockResolvedValue(fake);
    try {
      await assertWithinBudget('delta-livestock');
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
    advancedCreds();
    const fake = makeAtomicPrisma({
      aiBudgetMonthSpentZar: 150,
      aiBudgetMonthKey: currentMonthKey(new Date()),
      aiSettings: ragWithCap(100),
    });
    getPrismaForFarmMock.mockResolvedValue(fake);
    await expect(assertWithinBudget('delta-livestock')).rejects.toBeInstanceOf(
      EinsteinBudgetError,
    );
  });

  it('stale aiBudgetMonthKey rolls over — advanced tier treated as 0 spent', async () => {
    advancedCreds();
    const fake = makeAtomicPrisma({
      aiBudgetMonthSpentZar: 500,
      aiBudgetMonthKey: '1999-01', // stale
      aiSettings: ragWithCap(100),
    });
    getPrismaForFarmMock.mockResolvedValue(fake);
    const result = await assertWithinBudget('delta-livestock');
    // Cap 100 - 0 = 100 remaining because prior month's 500 is ignored.
    expect(result.remainingZar).toBe(100);
  });

  it('missing ragConfig blob defaults cap to DEFAULT_BUDGET_CAP_ZAR (100)', async () => {
    advancedCreds();
    const fake = makeAtomicPrisma({
      aiBudgetMonthSpentZar: 0,
      aiBudgetMonthKey: null,
      aiSettings: null, // no aiSettings → cap defaults
    });
    getPrismaForFarmMock.mockResolvedValue(fake);
    const result = await assertWithinBudget('delta-livestock');
    expect(result.remainingZar).toBe(100);
  });

  it('farm not found in meta DB throws typed error', async () => {
    getFarmCredsMock.mockResolvedValue(null);
    await expect(assertWithinBudget('no-such')).rejects.toBeInstanceOf(EinsteinBudgetError);
  });

  it('FarmSettings row missing throws SETTINGS_MISSING', async () => {
    advancedCreds();
    const fake = {
      farmSettings: { findFirst: vi.fn().mockResolvedValue(null) },
      $executeRawUnsafe: vi.fn(),
    };
    getPrismaForFarmMock.mockResolvedValue(fake);
    try {
      await assertWithinBudget('delta-livestock');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EinsteinBudgetError);
      expect((err as InstanceType<typeof EinsteinBudgetError>).code).toBe(
        'EINSTEIN_BUDGET_SETTINGS_MISSING',
      );
    }
  });
});

describe('stampCostBeforeSend — atomic mark-before-send', () => {
  it('consulting tier returns without writing', async () => {
    getFarmCredsMock.mockResolvedValue({
      tursoUrl: 'x',
      tursoAuthToken: 'y',
      tier: 'consulting',
    });
    await stampCostBeforeSend('mega-farm', 5);
    expect(getPrismaForFarmMock).not.toHaveBeenCalled();
  });

  it('advanced tier increments the counter column atomically', async () => {
    advancedCreds();
    const fake = makeAtomicPrisma({
      aiBudgetMonthSpentZar: 10,
      aiBudgetMonthKey: currentMonthKey(new Date()),
    });
    getPrismaForFarmMock.mockResolvedValue(fake);

    await stampCostBeforeSend('delta-livestock', 3);

    expect(fake.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    expect(fake.row.aiBudgetMonthSpentZar).toBeCloseTo(13, 5);
    expect(fake.row.aiBudgetMonthKey).toBe(currentMonthKey(new Date()));
  });

  it('LOST-UPDATE PROOF: N concurrent stamps sum exactly (no lost updates)', async () => {
    advancedCreds();
    const fake = makeAtomicPrisma({
      aiBudgetMonthSpentZar: 0,
      aiBudgetMonthKey: currentMonthKey(new Date()),
    });
    getPrismaForFarmMock.mockResolvedValue(fake);

    // Fire 10 concurrent stamps of 5 each. With a read-modify-write writer
    // these would interleave and lose increments (final < 50). The atomic
    // single-statement UPDATE the fake models guarantees the full sum.
    const N = 10;
    const COST = 5;
    await Promise.all(
      Array.from({ length: N }, () => stampCostBeforeSend('delta-livestock', COST)),
    );

    expect(fake.$executeRawUnsafe).toHaveBeenCalledTimes(N);
    expect(fake.row.aiBudgetMonthSpentZar).toBeCloseTo(N * COST, 5);
  });

  it('rejects negative estimatedCostZar', async () => {
    await expect(stampCostBeforeSend('x', -1)).rejects.toBeInstanceOf(EinsteinBudgetError);
  });

  it('resets counter on monthly rollover (stale key → new cost only)', async () => {
    advancedCreds();
    const fake = makeAtomicPrisma({
      aiBudgetMonthSpentZar: 99,
      aiBudgetMonthKey: '1999-01', // stale
    });
    getPrismaForFarmMock.mockResolvedValue(fake);

    await stampCostBeforeSend('delta-livestock', 5);

    // Stale 99 ZAR discarded; new spend starts at 5.
    expect(fake.row.aiBudgetMonthSpentZar).toBeCloseTo(5, 5);
    expect(fake.row.aiBudgetMonthKey).toBe(currentMonthKey(new Date()));
  });

  it('FarmSettings row missing throws SETTINGS_MISSING (no rows updated)', async () => {
    advancedCreds();
    const fake = {
      farmSettings: { findFirst: vi.fn() },
      $executeRawUnsafe: vi.fn().mockResolvedValue(0), // 0 rows affected
    };
    getPrismaForFarmMock.mockResolvedValue(fake);
    try {
      await stampCostBeforeSend('delta-livestock', 5);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EinsteinBudgetError);
      expect((err as InstanceType<typeof EinsteinBudgetError>).code).toBe(
        'EINSTEIN_BUDGET_SETTINGS_MISSING',
      );
    }
  });
});

describe('reconcileCostAfterSend — post-send reconciliation (api-F1/EIN-2)', () => {
  it('applies a positive delta on top of the stamped spend', async () => {
    advancedCreds();
    const fake = makeAtomicPrisma({
      aiBudgetMonthSpentZar: 13,
      aiBudgetMonthKey: currentMonthKey(new Date()),
    });
    getPrismaForFarmMock.mockResolvedValue(fake);

    await reconcileCostAfterSend('delta-livestock', 2);
    expect(fake.row.aiBudgetMonthSpentZar).toBeCloseTo(15, 5);
  });

  it('credits back a negative delta (actual cost below the pessimistic stamp)', async () => {
    advancedCreds();
    const fake = makeAtomicPrisma({
      aiBudgetMonthSpentZar: 13,
      aiBudgetMonthKey: currentMonthKey(new Date()),
    });
    getPrismaForFarmMock.mockResolvedValue(fake);

    await reconcileCostAfterSend('delta-livestock', -2.5);
    expect(fake.row.aiBudgetMonthSpentZar).toBeCloseTo(10.5, 5);
  });

  it('clamps the counter at zero on an over-credit', async () => {
    advancedCreds();
    const fake = makeAtomicPrisma({
      aiBudgetMonthSpentZar: 1,
      aiBudgetMonthKey: currentMonthKey(new Date()),
    });
    getPrismaForFarmMock.mockResolvedValue(fake);

    await reconcileCostAfterSend('delta-livestock', -5);
    expect(fake.row.aiBudgetMonthSpentZar).toBe(0);
  });

  it('clamps to zero when a negative delta lands after a monthly rollover', async () => {
    advancedCreds();
    const fake = makeAtomicPrisma({
      aiBudgetMonthSpentZar: 50,
      aiBudgetMonthKey: '1999-01', // stale → resets to deltaZar, then MAX(0,·)
    });
    getPrismaForFarmMock.mockResolvedValue(fake);

    await reconcileCostAfterSend('delta-livestock', -3);
    // After rollover the reset value is the (negative) delta; MAX(0, -3) = 0.
    expect(fake.row.aiBudgetMonthSpentZar).toBe(0);
    expect(fake.row.aiBudgetMonthKey).toBe(currentMonthKey(new Date()));
  });

  it('consulting tier returns without writing (budget-exempt)', async () => {
    getFarmCredsMock.mockResolvedValue({
      tursoUrl: 'x',
      tursoAuthToken: 'y',
      tier: 'consulting',
    });
    await reconcileCostAfterSend('mega-farm', -3);
    expect(getPrismaForFarmMock).not.toHaveBeenCalled();
  });

  it('throws EINSTEIN_BUDGET_BAD_DELTA on a non-finite delta', async () => {
    try {
      await reconcileCostAfterSend('delta-livestock', Number.NaN);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EinsteinBudgetError);
      expect((err as InstanceType<typeof EinsteinBudgetError>).code).toBe(
        'EINSTEIN_BUDGET_BAD_DELTA',
      );
    }
  });

  it('rolls over a stale month key — positive delta applies to a fresh counter', async () => {
    advancedCreds();
    const fake = makeAtomicPrisma({
      aiBudgetMonthSpentZar: 99,
      aiBudgetMonthKey: '1999-01', // stale
    });
    getPrismaForFarmMock.mockResolvedValue(fake);

    await reconcileCostAfterSend('delta-livestock', 4);
    expect(fake.row.aiBudgetMonthSpentZar).toBeCloseTo(4, 5);
    expect(fake.row.aiBudgetMonthKey).toBe(currentMonthKey(new Date()));
  });
});

describe('resetMonthlyBudget', () => {
  it('zeroes the counter column + writes the current month key', async () => {
    const fake = makeAtomicPrisma({
      aiBudgetMonthSpentZar: 88,
      aiBudgetMonthKey: '1999-01',
    });
    getPrismaForFarmMock.mockResolvedValue(fake);
    await resetMonthlyBudget('delta-livestock');
    expect(fake.row.aiBudgetMonthSpentZar).toBe(0);
    expect(fake.row.aiBudgetMonthKey).toBe(currentMonthKey(new Date()));
  });
});
