// __tests__/lib/logger.test.ts
//
// TDD: RED tests for M2 — nested Error instances in logger payloads.
//
// The bug: logger.ts's normaliseRest() only serialises an Error when the
// *entire* rest arg is an Error.  Call sites that pass `{ err: new Error() }`
// or `{ a: { b: new Error() } }` get `{}` in production JSON because
// JSON.stringify silently drops Error prototype fields.
//
// Each test runs with NODE_ENV=production so the JSON-emit branch executes.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Force production mode so the JSON branch runs ───────────────────────────
// We need to re-import the logger with NODE_ENV=production.  Vitest runs in
// Node where process.env mutation works; vi.resetModules() lets us re-eval
// the module after changing the env var.

async function importLoggerInProd() {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'production');
  const mod = await import('@/lib/logger');
  vi.unstubAllEnvs();
  return mod.logger;
}

// Parse the JSON string the logger emitted and return `details` field.
function capturedDetails(spy: ReturnType<typeof vi.spyOn>): unknown {
  const call = spy.mock.calls[0];
  if (!call) throw new Error('spy was not called');
  const raw = call[0] as string;
  const parsed = JSON.parse(raw) as { details?: unknown };
  return parsed.details;
}

describe('logger — production JSON output', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // eslint-disable-next-line no-console
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // eslint-disable-next-line no-console
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // eslint-disable-next-line no-console
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Case 1: Error nested directly in record ───────────────────────────────
  it('serialises a nested Error passed as { err: new Error("boom") }', async () => {
    const logger = await importLoggerInProd();
    logger.error('ctx', { err: new Error('boom') });

    const details = capturedDetails(errorSpy) as Record<string, unknown>;
    const errField = details.err as Record<string, unknown>;

    expect(errField).toBeDefined();
    expect(errField.name).toBe('Error');
    expect(errField.message).toBe('boom');
    expect(typeof errField.stack).toBe('string');
  });

  // ── Case 2: Error nested two levels deep ─────────────────────────────────
  it('serialises an Error nested two levels deep { a: { b: new Error("c") } }', async () => {
    const logger = await importLoggerInProd();
    logger.error('ctx', { a: { b: new Error('c') } });

    const details = capturedDetails(errorSpy) as {
      a: { b: { message: string } };
    };

    expect(details.a.b.message).toBe('c');
  });

  // ── Case 3: Array of Errors ───────────────────────────────────────────────
  it('serialises Errors inside an array field', async () => {
    const logger = await importLoggerInProd();
    logger.warn('ctx', { errors: [new Error('a'), new Error('b')] });

    const details = capturedDetails(warnSpy) as {
      errors: Array<{ message: string }>;
    };

    expect(details.errors[0].message).toBe('a');
    expect(details.errors[1].message).toBe('b');
  });

  // ── Case 4: Error cause chain ─────────────────────────────────────────────
  it('serialises an Error cause chain', async () => {
    const logger = await importLoggerInProd();
    const inner = new Error('inner');
    const outer = new Error('outer', { cause: inner });
    logger.error('ctx', { err: outer });

    const details = capturedDetails(errorSpy) as {
      err: { message: string; cause: { message: string } };
    };

    expect(details.err.message).toBe('outer');
    expect(details.err.cause).toBeDefined();
    expect((details.err.cause as { message: string }).message).toBe('inner');
  });

  // ── Case 5: Cycle safety ──────────────────────────────────────────────────
  it('does not throw on circular references — replaces cycle with "[Circular]"', async () => {
    const logger = await importLoggerInProd();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o: any = {};
    o.self = o;

    expect(() => logger.error('ctx', { o })).not.toThrow();

    const details = capturedDetails(errorSpy) as {
      o: { self: unknown };
    };
    expect(details.o.self).toBe('[Circular]');
  });

  // ── Case 6: Top-level Error regression ───────────────────────────────────
  it('preserves the existing top-level Error serialisation path', async () => {
    const logger = await importLoggerInProd();
    logger.error('ctx', new Error('top'));

    const details = capturedDetails(errorSpy) as {
      error: { name: string; message: string; stack: string };
    };

    expect(details.error.name).toBe('Error');
    expect(details.error.message).toBe('top');
    expect(typeof details.error.stack).toBe('string');
  });

  // ── Case 7: Dev mode — pretty-print passthrough (no JSON shape asserted) ──
  it('does not emit a JSON line in development mode', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    const { logger } = await import('@/lib/logger');
    vi.unstubAllEnvs();

    logger.error('ctx', { err: new Error('dev') });

    // In dev the logger calls console.error with two args (msg, payload),
    // NOT a JSON string as the first arg.
    const call = errorSpy.mock.calls[0];
    expect(call).toBeDefined();
    const firstArg = call[0] as string;
    // First arg should be the plain message string, not a JSON object string.
    expect(() => JSON.parse(firstArg)).toThrow();
  });
});
