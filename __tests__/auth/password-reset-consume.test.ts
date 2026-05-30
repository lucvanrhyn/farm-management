/**
 * Unit tests for the password-reset CONSUME helpers in lib/meta-db.ts
 * (issue #102 slice 2).
 *
 * Functions under test:
 *   - consumePasswordResetToken(token)  — atomic lookup + expiry check
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

  it('returns { userId } and clears the reset columns when token is valid and not expired', async () => {
    // First call: SELECT → one row found (token exists, not expired)
    executeMock
      .mockResolvedValueOnce(makeRows([{ id: 'user-123' }]))
      // Second call: UPDATE → clears the token
      .mockResolvedValueOnce(emptyRows());

    const result = await consumePasswordResetToken('valid-token-abc');

    expect(result).toEqual({ userId: 'user-123' });

    // SELECT must use the token AND check expiry
    // executeMock.mock.calls[N] = [arg0] where arg0 = { sql, args }
    const selectCall = executeMock.mock.calls[0][0] as { sql: string; args: unknown[] };
    expect(selectCall.sql).toMatch(/password_reset_token\s*=\s*\?/i);
    expect(selectCall.sql).toMatch(/password_reset_expires\s*>\s*\?/i);
    expect(selectCall.args).toContain('valid-token-abc');

    // UPDATE must clear both columns
    const updateCall = executeMock.mock.calls[1][0] as { sql: string; args: unknown[] };
    expect(updateCall.sql).toMatch(/password_reset_token\s*=\s*NULL/i);
    expect(updateCall.sql).toMatch(/password_reset_expires\s*=\s*NULL/i);
    expect(updateCall.args).toContain('user-123');
  });

  it('returns null for an expired token — expiry enforced at DB level', async () => {
    // SELECT returns no rows because `password_reset_expires > now` fails
    executeMock.mockResolvedValueOnce(emptyRows());

    const result = await consumePasswordResetToken('expired-token-xyz');

    expect(result).toBeNull();
    // UPDATE must NOT run — no side-effect on failure
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('returns null for an unknown/absent token — no enumeration signal', async () => {
    executeMock.mockResolvedValueOnce(emptyRows());

    const result = await consumePasswordResetToken('unknown-token');

    expect(result).toBeNull();
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('single-use: second consume after first returns null (token cleared)', async () => {
    // First consume: row found, then cleared
    executeMock
      .mockResolvedValueOnce(makeRows([{ id: 'user-123' }]))
      .mockResolvedValueOnce(emptyRows());

    const first = await consumePasswordResetToken('use-once-token');
    expect(first).toEqual({ userId: 'user-123' });

    // Second consume: no row (cleared by first call's UPDATE)
    executeMock.mockResolvedValueOnce(emptyRows());

    const second = await consumePasswordResetToken('use-once-token');
    expect(second).toBeNull();
  });

  it('passes the current time as the expiry comparison argument', async () => {
    const before = new Date().toISOString();
    executeMock.mockResolvedValueOnce(emptyRows());

    await consumePasswordResetToken('any-token');

    const after = new Date().toISOString();
    const selectCall = executeMock.mock.calls[0][0] as { sql: string; args: unknown[] };
    // Second arg should be an ISO string between before and after
    const nowArg = selectCall.args[1] as string;
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
