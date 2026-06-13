import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { assertPayfastConfig, buildSubscriptionParams } from '../payfast';

const BASE_OPTS = {
  farmSlug: 'basson',
  farmDisplayName: 'Acme Cattle',
  userEmail: 'luc@example.com',
  userFirstName: 'Luc',
  returnUrl: 'https://farmtrack.test/subscribe/complete',
  cancelUrl: 'https://farmtrack.test/subscribe?cancelled=true',
  notifyUrl: 'https://farmtrack.test/api/webhooks/payfast',
};

describe('buildSubscriptionParams', () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    envBackup.PAYFAST_MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID;
    envBackup.PAYFAST_MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY;
    process.env.PAYFAST_MERCHANT_ID = 'test-merchant';
    process.env.PAYFAST_MERCHANT_KEY = 'test-key';
  });

  afterEach(() => {
    process.env.PAYFAST_MERCHANT_ID = envBackup.PAYFAST_MERCHANT_ID;
    process.env.PAYFAST_MERCHANT_KEY = envBackup.PAYFAST_MERCHANT_KEY;
  });

  it('sets amount and recurring_amount from amountZar (monthly Basic, 800 LSU → R240)', () => {
    const params = buildSubscriptionParams({
      ...BASE_OPTS,
      tier: 'basic',
      amountZar: 240,
      frequency: 'monthly',
    });
    expect(params.amount).toBe('240.00');
    expect(params.recurring_amount).toBe('240.00');
  });

  it('sets frequency code to 3 for monthly', () => {
    const params = buildSubscriptionParams({
      ...BASE_OPTS,
      tier: 'basic',
      amountZar: 240,
      frequency: 'monthly',
    });
    expect(params.frequency).toBe('3');
  });

  it('sets frequency code to 6 for annual', () => {
    const params = buildSubscriptionParams({
      ...BASE_OPTS,
      tier: 'advanced',
      amountZar: 11000,
      frequency: 'annual',
    });
    expect(params.frequency).toBe('6');
  });

  it('encodes tier in custom_str2 and frequency in custom_str3', () => {
    const params = buildSubscriptionParams({
      ...BASE_OPTS,
      tier: 'advanced',
      amountZar: 11000,
      frequency: 'annual',
    });
    expect(params.custom_str1).toBe('basson');
    expect(params.custom_str2).toBe('advanced');
    expect(params.custom_str3).toBe('annual');
  });

  it('encodes tier name in item_name', () => {
    const params = buildSubscriptionParams({
      ...BASE_OPTS,
      tier: 'advanced',
      amountZar: 11000,
      frequency: 'annual',
    });
    expect(params.item_name).toContain('Advanced');
    expect(params.item_name).toContain('Annual');
  });

  it('rejects non-integer amountZar', () => {
    expect(() =>
      buildSubscriptionParams({
        ...BASE_OPTS,
        tier: 'basic',
        amountZar: 240.5,
        frequency: 'monthly',
      }),
    ).toThrow(/integer/);
  });
});

// ── S32a (H5/PF-02): passphrase must be salted in production ───────────────
describe('assertPayfastConfig', () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    envBackup.NODE_ENV = process.env.NODE_ENV;
    envBackup.PAYFAST_PASSPHRASE = process.env.PAYFAST_PASSPHRASE;
  });

  afterEach(() => {
    // Restore via defineProperty — NODE_ENV is read-only on the Next.js types.
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: envBackup.NODE_ENV,
      configurable: true,
      enumerable: true,
      writable: true,
    });
    if (envBackup.PAYFAST_PASSPHRASE === undefined) {
      delete process.env.PAYFAST_PASSPHRASE;
    } else {
      process.env.PAYFAST_PASSPHRASE = envBackup.PAYFAST_PASSPHRASE;
    }
  });

  function setNodeEnv(value: string): void {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  }

  it('throws in production when PAYFAST_PASSPHRASE is unset (signatures would be unsalted)', () => {
    setNodeEnv('production');
    delete process.env.PAYFAST_PASSPHRASE;
    expect(() => assertPayfastConfig()).toThrow(/PAYFAST_PASSPHRASE/);
  });

  it('throws in production when PAYFAST_PASSPHRASE is empty', () => {
    setNodeEnv('production');
    process.env.PAYFAST_PASSPHRASE = '';
    expect(() => assertPayfastConfig()).toThrow(/PAYFAST_PASSPHRASE/);
  });

  it('does NOT throw in production when PAYFAST_PASSPHRASE is set', () => {
    setNodeEnv('production');
    process.env.PAYFAST_PASSPHRASE = 'a-real-passphrase';
    expect(() => assertPayfastConfig()).not.toThrow();
  });

  it('does NOT throw in development when PAYFAST_PASSPHRASE is unset (sandbox/dev allowed)', () => {
    setNodeEnv('development');
    delete process.env.PAYFAST_PASSPHRASE;
    expect(() => assertPayfastConfig()).not.toThrow();
  });

  it('does NOT throw in test when PAYFAST_PASSPHRASE is unset', () => {
    setNodeEnv('test');
    delete process.env.PAYFAST_PASSPHRASE;
    expect(() => assertPayfastConfig()).not.toThrow();
  });
});
