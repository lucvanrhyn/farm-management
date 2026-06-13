import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S29 (H6 / OB-007) — provisionFarm must compensate ALL meta-DB writes on
 * failure, not just delete the Turso DB.
 *
 * Before this fix, the catch in `lib/provisioning.ts` deleted only the Turso
 * database. Any failure after `createUser` / `createFarm` / `createFarmUser`
 * (including a flaky `sendVerificationEmail`) left orphaned meta rows pointing
 * at a now-deleted DB — a tenant the registrant can never log into.
 *
 * The fix tracks which steps succeeded and, in the catch, best-effort deletes
 * in REVERSE order: farm_users mapping → farm → user, THEN the Turso DB. Each
 * delete is independently wrapped so one failure doesn't abort the others.
 */

// ── Mocks ────────────────────────────────────────────────────────────────────
const createTursoDatabaseMock = vi.fn();
const deleteTursoDatabaseMock = vi.fn();
const seedFarmDatabaseMock = vi.fn();
const generateSlugMock = vi.fn();

const createUserMock = vi.fn();
const createFarmMock = vi.fn();
const createFarmUserMock = vi.fn();
const setVerificationTokenMock = vi.fn();
const deleteFarmUserMock = vi.fn();
const deleteFarmMock = vi.fn();
const deleteUserMock = vi.fn();

const generateVerificationTokenMock = vi.fn();
const sendVerificationEmailMock = vi.fn();

vi.mock('@/lib/turso-api', () => ({
  createTursoDatabase: (...a: unknown[]) => createTursoDatabaseMock(...a),
  deleteTursoDatabase: (...a: unknown[]) => deleteTursoDatabaseMock(...a),
}));
vi.mock('../../lib/turso-api', () => ({
  createTursoDatabase: (...a: unknown[]) => createTursoDatabaseMock(...a),
  deleteTursoDatabase: (...a: unknown[]) => deleteTursoDatabaseMock(...a),
}));
vi.mock('@/lib/seed-farm-db', () => ({
  seedFarmDatabase: (...a: unknown[]) => seedFarmDatabaseMock(...a),
}));
vi.mock('../../lib/seed-farm-db', () => ({
  seedFarmDatabase: (...a: unknown[]) => seedFarmDatabaseMock(...a),
}));
vi.mock('@/lib/slug', () => ({
  generateSlug: (...a: unknown[]) => generateSlugMock(...a),
}));
vi.mock('../../lib/slug', () => ({
  generateSlug: (...a: unknown[]) => generateSlugMock(...a),
}));
vi.mock('@/lib/meta-db', () => ({
  createUser: (...a: unknown[]) => createUserMock(...a),
  createFarm: (...a: unknown[]) => createFarmMock(...a),
  createFarmUser: (...a: unknown[]) => createFarmUserMock(...a),
  setVerificationToken: (...a: unknown[]) => setVerificationTokenMock(...a),
  deleteFarmUser: (...a: unknown[]) => deleteFarmUserMock(...a),
  deleteFarm: (...a: unknown[]) => deleteFarmMock(...a),
  deleteUser: (...a: unknown[]) => deleteUserMock(...a),
}));
vi.mock('../../lib/meta-db', () => ({
  createUser: (...a: unknown[]) => createUserMock(...a),
  createFarm: (...a: unknown[]) => createFarmMock(...a),
  createFarmUser: (...a: unknown[]) => createFarmUserMock(...a),
  setVerificationToken: (...a: unknown[]) => setVerificationTokenMock(...a),
  deleteFarmUser: (...a: unknown[]) => deleteFarmUserMock(...a),
  deleteFarm: (...a: unknown[]) => deleteFarmMock(...a),
  deleteUser: (...a: unknown[]) => deleteUserMock(...a),
}));
vi.mock('@/lib/email-verification', () => ({
  generateVerificationToken: (...a: unknown[]) => generateVerificationTokenMock(...a),
  sendVerificationEmail: (...a: unknown[]) => sendVerificationEmailMock(...a),
}));
vi.mock('../../lib/email-verification', () => ({
  generateVerificationToken: (...a: unknown[]) => generateVerificationTokenMock(...a),
  sendVerificationEmail: (...a: unknown[]) => sendVerificationEmailMock(...a),
}));

const { provisionFarm } = await import('@/lib/provisioning');

const INPUT = {
  name: 'Jan',
  email: 'jan@example.com',
  username: 'janvdm',
  passwordHash: '$2a$12$hash',
  farmName: 'Rietfontein',
};

function resetAll(): void {
  for (const m of [
    createTursoDatabaseMock,
    deleteTursoDatabaseMock,
    seedFarmDatabaseMock,
    generateSlugMock,
    createUserMock,
    createFarmMock,
    createFarmUserMock,
    setVerificationTokenMock,
    deleteFarmUserMock,
    deleteFarmMock,
    deleteUserMock,
    generateVerificationTokenMock,
    sendVerificationEmailMock,
  ]) {
    m.mockReset();
  }
  generateSlugMock.mockResolvedValue('rietfontein');
  createTursoDatabaseMock.mockResolvedValue({ url: 'libsql://x', token: 'tok' });
  seedFarmDatabaseMock.mockResolvedValue(undefined);
  createUserMock.mockResolvedValue(undefined);
  createFarmMock.mockResolvedValue(undefined);
  createFarmUserMock.mockResolvedValue(undefined);
  setVerificationTokenMock.mockResolvedValue(undefined);
  deleteFarmUserMock.mockResolvedValue(undefined);
  deleteFarmMock.mockResolvedValue(undefined);
  deleteUserMock.mockResolvedValue(undefined);
  deleteTursoDatabaseMock.mockResolvedValue(undefined);
  generateVerificationTokenMock.mockReturnValue({ token: 'vt', expiresAt: '2099-01-01' });
  sendVerificationEmailMock.mockResolvedValue(undefined);
}

describe('provisionFarm — happy path', () => {
  beforeEach(resetAll);

  it('runs all steps and never touches the cleanup path', async () => {
    const result = await provisionFarm(INPUT);
    expect(result.slug).toBe('rietfontein');
    expect(typeof result.userId).toBe('string');
    expect(deleteTursoDatabaseMock).not.toHaveBeenCalled();
    expect(deleteUserMock).not.toHaveBeenCalled();
    expect(deleteFarmMock).not.toHaveBeenCalled();
    expect(deleteFarmUserMock).not.toHaveBeenCalled();
  });
});

describe('provisionFarm — H6 compensating cleanup', () => {
  beforeEach(resetAll);

  it('when sendVerificationEmail throws: compensates user+farm+mapping then DB, in reverse order, and rethrows', async () => {
    const boom = new Error('SMTP down');
    sendVerificationEmailMock.mockRejectedValueOnce(boom);

    await expect(provisionFarm(INPUT)).rejects.toBe(boom);

    // All four compensations ran.
    expect(deleteFarmUserMock).toHaveBeenCalledTimes(1);
    expect(deleteFarmMock).toHaveBeenCalledTimes(1);
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
    expect(deleteTursoDatabaseMock).toHaveBeenCalledTimes(1);

    // Reverse order: farm_users → farm → user → turso DB.
    const order = (m: typeof deleteFarmUserMock) => m.mock.invocationCallOrder[0];
    expect(order(deleteFarmUserMock)).toBeLessThan(order(deleteFarmMock));
    expect(order(deleteFarmMock)).toBeLessThan(order(deleteUserMock));
    expect(order(deleteUserMock)).toBeLessThan(order(deleteTursoDatabaseMock));
  });

  it('when createFarmUser throws: compensates farm+user (no mapping created) then DB', async () => {
    const boom = new Error('mapping insert failed');
    createFarmUserMock.mockRejectedValueOnce(boom);

    await expect(provisionFarm(INPUT)).rejects.toBe(boom);

    // farm_users mapping was never created → don't delete it.
    expect(deleteFarmUserMock).not.toHaveBeenCalled();
    expect(deleteFarmMock).toHaveBeenCalledTimes(1);
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
    expect(deleteTursoDatabaseMock).toHaveBeenCalledTimes(1);
  });

  it('when createFarm throws: compensates only the user then DB', async () => {
    const boom = new Error('farm insert failed');
    createFarmMock.mockRejectedValueOnce(boom);

    await expect(provisionFarm(INPUT)).rejects.toBe(boom);

    expect(deleteFarmUserMock).not.toHaveBeenCalled();
    expect(deleteFarmMock).not.toHaveBeenCalled();
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
    expect(deleteTursoDatabaseMock).toHaveBeenCalledTimes(1);
  });

  it('when createUser throws (e.g. H7 duplicate username): no meta rows exist, only the DB is deleted', async () => {
    const boom = new Error('UNIQUE constraint failed: users.username');
    createUserMock.mockRejectedValueOnce(boom);

    await expect(provisionFarm(INPUT)).rejects.toBe(boom);

    expect(deleteFarmUserMock).not.toHaveBeenCalled();
    expect(deleteFarmMock).not.toHaveBeenCalled();
    expect(deleteUserMock).not.toHaveBeenCalled();
    expect(deleteTursoDatabaseMock).toHaveBeenCalledTimes(1);
  });

  it('when seedFarmDatabase throws (before any meta write): only the DB is deleted', async () => {
    const boom = new Error('seed failed');
    seedFarmDatabaseMock.mockRejectedValueOnce(boom);

    await expect(provisionFarm(INPUT)).rejects.toBe(boom);

    expect(deleteUserMock).not.toHaveBeenCalled();
    expect(deleteFarmMock).not.toHaveBeenCalled();
    expect(deleteFarmUserMock).not.toHaveBeenCalled();
    expect(deleteTursoDatabaseMock).toHaveBeenCalledTimes(1);
  });

  it('a failing compensating delete does not abort the others, and the original error still propagates', async () => {
    const boom = new Error('SMTP down');
    sendVerificationEmailMock.mockRejectedValueOnce(boom);
    // The farm-row delete fails — the user delete and DB delete must still run.
    deleteFarmMock.mockRejectedValueOnce(new Error('meta delete flaked'));

    await expect(provisionFarm(INPUT)).rejects.toBe(boom);

    expect(deleteFarmUserMock).toHaveBeenCalledTimes(1);
    expect(deleteFarmMock).toHaveBeenCalledTimes(1);
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
    expect(deleteTursoDatabaseMock).toHaveBeenCalledTimes(1);
  });
});
