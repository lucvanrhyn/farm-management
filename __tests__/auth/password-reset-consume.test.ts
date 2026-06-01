/**
 * Unit tests for the password-reset CONSUME helpers in lib/meta-db.ts
 * (issue #102 slice 2).
 *
 * Functions under test:
 *   - consumePasswordResetToken(token)  — atomic single-statement consume
 *   - resetUserPassword(userId, hash)   — clears reset columns + updates hash
 *
 * Mirrors the test style of the verifyUserEmail tests; uses __setMetaClientForTest
 * to inject a Turso-shaped in-memory client mock.
 *
 * Security properties asserted:
 *   - Expired token returns null (expiry enforced in SQL `> now`)
 *   - Unknown/absent token returns null (no enumeration leak)
 *   - Single-use: consuming the token clears it so a second consume returns null
 *   - Happy path: returns { userId } and clears the reset columns atomically
 *   - ATOMICITY: the consume is a single UPDATE ... RETURNING statement — there
 *     is no SELECT-then-UPDATE window where a concurrent request could validate
 *     the same token between the SELECT and the UPDATE.
 *   - resetUserPassword writes bcrypt hash + clears reset token + expiry columns
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Client, ResultSet } from '@libsql/client';

// ── Minimal libsql ResultSet factories ──────────────────────────────────────

function makeRows(rows: Record<string, unknown>[]): ResultSet {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return {
    columns,
    rows: rows.map((r) =>
      columns.map((c) => r[c]) as unknown as ResultSet['rows'][number],
    ),
    rowsAffected: rows.length,
    lastInsertRowid: undefined,
    toJSON: () => ({}),
  } as unknown as ResultSet;
}

function emptyRows(): ResultSet {
  return makeRows([]);
}

// ── Build a minimal mock Client ──────────────────────────────────────────────

function makeMockClient(): {
  client: Client;
  executeMock: ReturnType<typeof vi.fn>;
} {
  const executeMock = vi.fn();
  const client = { execute: executeMock } as unknown as Client;
  return { client, executeMock };
}

// Import AFTER mocks are in place.
const {
  __setMetaClientForTest,
  consumePasswordResetToken,
  resetUserPassword,
} = await import('@/lib/meta-db');

describe('consumePasswordResetToken()', () => {
  let executeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const mock = makeMockClient();
    executeMock = mock.executeMock;
    __setMetaClientForTest(mock.client);
  });

  // ── Core atomicity test (written first — RED before implementation change) ──

  it('ATOMICITY: issues exactly ONE statement that validates, consumes, and returns userId in a single UPDATE...RETURNING — no SELECT-then-UPDATE window', async () => {
    // The UPDATE...RETURNING returns one row on success.
    executeMock.mockResolvedValueOnce(makeRows([{ id: 'user-atomic' }]));

    const result = await consumePasswordResetToken('atomic-token');

    expect(result).toEqual({ userId: 'user-atomic' });

    // Must be EXACTLY one DB call — the whole operation is atomic.
    expect(executeMock).toHaveBeenCalledTimes(1);

    const stmt = executeMock.mock.calls[0][0] as { sql: string; args: unknown[] };

    // Must be an UPDATE (not SELECT) — validates and consumes in one shot.
    expect(stmt.sql.trim().toUpperCase()).toMatch(/^UPDATE\b/);

    // Must clear the token columns atomically within the same UPDATE.
    expect(stmt.sql).toMatch(/password_reset_token\s*=\s*NULL/i);
    expect(stmt.sql).toMatch(/password_reset_expires\s*=\s*NULL/i);

    // Expiry guard must live in the WHERE clause of the UPDATE itself,
    // not in a prior SELECT — this is what closes the TOCTOU window.
    expect(stmt.sql).toMatch(/WHERE/i);
    expect(stmt.sql).toMatch(/password_reset_token\s*=\s*\?/i);
    expect(stmt.sql).toMatch(/password_reset_expires\s*>\s*\?/i);

    // The token must be an argument to the UPDATE (not a separate query).
    expect(stmt.args).toContain('atomic-token');

    // Must use RETURNING to get back the userId without a second round-trip.
    expect(stmt.sql).toMatch(/RETURNING\b/i);
  });

  // ── Happy path ───────────────────────────────────────────────────────────────

  it('returns { userId } and clears the reset columns when token is valid and not expired', async () => {
    // Single UPDATE...RETURNING returns one row (token matched, not expired,
    // columns cleared, userId returned) in one shot.
    executeMock.mockResolvedValueOnce(makeRows([{ id: 'user-123' }]));

    const result = await consumePasswordResetToken('valid-token-abc');

    expect(result).toEqual({ userId: 'user-123' });

    // Only one DB call — no separate SELECT.
    expect(executeMock).toHaveBeenCalledTimes(1);

    const stmt = executeMock.mock.calls[0][0] as { sql: string; args: unknown[] };
    // Expiry guard in the UPDATE WHERE clause.
    expect(stmt.sql).toMatch(/password_reset_token\s*=\s*\?/i);
    expect(stmt.sql).toMatch(/password_reset_expires\s*>\s*\?/i);
    expect(stmt.args).toContain('valid-token-abc');

    // Token cleared in the SET clause.
    expect(stmt.sql).toMatch(/password_reset_token\s*=\s*NULL/i);
    expect(stmt.sql).toMatch(/password_reset_expires\s*=\s*NULL/i);
  });

  // ── Failure paths ─────────────────────────────────────────────────────────

  it('returns null for an expired token — expiry enforced at DB level', async () => {
    // UPDATE returns zero rows because `password_reset_expires > now` fails.
    executeMock.mockResolvedValueOnce(emptyRows());

    const result = await consumePasswordResetToken('expired-token-xyz');

    expect(result).toBeNull();
    // Only one DB call — no separate cleanup needed.
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('returns null for an unknown/absent token — no enumeration signal', async () => {
    executeMock.mockResolvedValueOnce(emptyRows());

    const result = await consumePasswordResetToken('unknown-token');

    expect(result).toBeNull();
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('single-use: second consume after first returns null (token cleared by first UPDATE)', async () => {
    // First consume: UPDATE matches and clears the token → returns one row.
    executeMock.mockResolvedValueOnce(makeRows([{ id: 'user-123' }]));

    const first = await consumePasswordResetToken('use-once-token');
    expect(first).toEqual({ userId: 'user-123' });

    // Second consume: UPDATE finds no matching row (already cleared) → zero rows.
    executeMock.mockResolvedValueOnce(emptyRows());

    const second = await consumePasswordResetToken('use-once-token');
    expect(second).toBeNull();
  });

  it('passes the current time as the expiry comparison argument in the UPDATE WHERE clause', async () => {
    const before = new Date().toISOString();
    executeMock.mockResolvedValueOnce(emptyRows());

    await consumePasswordResetToken('any-token');

    const after = new Date().toISOString();
    const stmt = executeMock.mock.calls[0][0] as { sql: string; args: unknown[] };
    // Second arg should be an ISO string between before and after.
    const nowArg = stmt.args[1] as string;
    expect(nowArg >= before).toBe(true);
    expect(nowArg <= after).toBe(true);
  });
});

describe('resetUserPassword()', () => {
  let executeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const mock = makeMockClient();
    executeMock = mock.executeMock;
    __setMetaClientForTest(mock.client);
  });

  it('updates password_hash and clears reset token + expiry in a single UPDATE', async () => {
    executeMock.mockResolvedValueOnce(emptyRows());

    await resetUserPassword('user-456', '$2a$12$newhashedpassword');

    expect(executeMock).toHaveBeenCalledTimes(1);
    const updateCall = executeMock.mock.calls[0][0] as { sql: string; args: unknown[] };
    // Must update the password hash
    expect(updateCall.sql).toMatch(/password_hash\s*=\s*\?/i);
    // Must clear reset columns atomically in the SAME statement
    expect(updateCall.sql).toMatch(/password_reset_token\s*=\s*NULL/i);
    expect(updateCall.sql).toMatch(/password_reset_expires\s*=\s*NULL/i);
    // Scoped to the correct user
    expect(updateCall.sql).toMatch(/WHERE\s+id\s*=\s*\?/i);
    expect(updateCall.args[0]).toBe('$2a$12$newhashedpassword');
    expect(updateCall.args[1]).toBe('user-456');
  });

  it('resolves without error on success', async () => {
    executeMock.mockResolvedValueOnce(emptyRows());
    await expect(
      resetUserPassword('user-456', '$2a$12$newhashedpassword'),
    ).resolves.toBeUndefined();
  });
});
