import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { promoteToProd, TenantParityFailedError } from '@/lib/ops/branch-clone';

/**
 * PRD #128 (2026-05-06): promoteToProd must call the parity verifier between
 * "run prod migration" and "mark meta row promoted". If any tenant is
 * missing any expected migration, the meta row stays un-promoted and a
 * TenantParityFailedError is thrown so the workflow can rollback.
 *
 * These tests exercise that gate explicitly — the historical
 * branch-clone.test.ts opts out via parityVerifyEnabled:false.
 */

async function seedBranchClonesTable(db: Client) {
  // Mirrors the canonical schema in __tests__/lib/ops/branch-clone.test.ts +
  // the PRD #128 additions (last_smoke_status / last_smoke_at).
  await db.execute(`
    CREATE TABLE branch_db_clones (
      branch_name        TEXT PRIMARY KEY,
      turso_db_name      TEXT NOT NULL,
      turso_db_url       TEXT NOT NULL,
      turso_auth_token   TEXT NOT NULL,
      source_db_name     TEXT NOT NULL,
      created_at         TEXT NOT NULL,
      last_promoted_at   TEXT,
      prod_migration_at  TEXT,
      head_sha           TEXT,
      soak_started_at    TEXT,
      last_smoke_status  TEXT,
      last_smoke_at      TEXT
    )
  `);
}

async function insertCloneRow(db: Client, args: { branch: string; createdAt: string }) {
  await db.execute({
    sql: `INSERT INTO branch_db_clones
            (branch_name, turso_db_name, turso_db_url, turso_auth_token, source_db_name, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [args.branch, 'ft-clone-test', 'libsql://x', 'tok', 'src', args.createdAt],
  });
}

describe('promoteToProd — parity verifier (PRD #128)', () => {
  let db: Client;
  const twoHoursAgo = '2026-05-06T10:00:00.000Z';
  const fakeNow = () => new Date('2026-05-06T12:30:00.000Z');

  beforeEach(async () => {
    db = createClient({ url: ':memory:' });
    await seedBranchClonesTable(db);
  });

  it('marks meta row promoted when every tenant reports parity', async () => {
    await insertCloneRow(db, { branch: 'wave/parity-ok', createdAt: twoHoursAgo });

    const result = await promoteToProd({
      branchName: 'wave/parity-ok',
      minSoakHours: 1,
      metaClient: db,
      now: fakeNow,
      runProdMigration: async () => ({ applied: ['0014_einstein_chunker_version.sql'], skipped: [] }),
      parityVerifyEnabled: true,
      verifyAllTenantsParity: async () => [
        {
          slug: 'tenant-a',
          report: {
            expected: ['0014_einstein_chunker_version.sql'],
            applied: ['0014_einstein_chunker_version.sql'],
            missing: [],
            extra: [],
            ok: true,
          },
        },
      ],
    });

    expect(result.parityResults).toHaveLength(1);
    expect(result.parityResults[0].report?.ok).toBe(true);
    expect(result.promotedAt).toBe('2026-05-06T12:30:00.000Z');

    // Verify the meta row was actually marked promoted.
    const after = await db.execute({
      sql: 'SELECT last_promoted_at FROM branch_db_clones WHERE branch_name = ?',
      args: ['wave/parity-ok'],
    });
    expect(after.rows[0].last_promoted_at).toBe('2026-05-06T12:30:00.000Z');
  });

  it('throws TenantParityFailedError + leaves meta row UN-promoted when a tenant is missing a migration', async () => {
    await insertCloneRow(db, { branch: 'wave/parity-fail', createdAt: twoHoursAgo });

    await expect(
      promoteToProd({
        branchName: 'wave/parity-fail',
        minSoakHours: 1,
        metaClient: db,
        now: fakeNow,
        runProdMigration: async () => ({
          applied: ['0014_einstein_chunker_version.sql'],
          skipped: [],
        }),
        parityVerifyEnabled: true,
        verifyAllTenantsParity: async () => [
          {
            slug: 'trio-b-boerdery',
            report: {
              expected: ['0014_einstein_chunker_version.sql'],
              applied: [], // The PRD #128 scenario — runner thought it applied, tenant disagrees.
              missing: ['0014_einstein_chunker_version.sql'],
              extra: [],
              ok: false,
            },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(TenantParityFailedError);

    // Meta row must NOT have been marked promoted.
    const after = await db.execute({
      sql: 'SELECT last_promoted_at FROM branch_db_clones WHERE branch_name = ?',
      args: ['wave/parity-fail'],
    });
    expect(after.rows[0].last_promoted_at).toBeNull();
  });

  it('throws TenantParityFailedError when verifier reports a per-tenant connection error', async () => {
    await insertCloneRow(db, { branch: 'wave/parity-conn', createdAt: twoHoursAgo });

    await expect(
      promoteToProd({
        branchName: 'wave/parity-conn',
        minSoakHours: 1,
        metaClient: db,
        now: fakeNow,
        runProdMigration: async () => ({ applied: [], skipped: [] }),
        parityVerifyEnabled: true,
        verifyAllTenantsParity: async () => [
          { slug: 'tenant-x', error: 'libSQL: token expired' },
        ],
      }),
    ).rejects.toBeInstanceOf(TenantParityFailedError);

    const after = await db.execute({
      sql: 'SELECT last_promoted_at FROM branch_db_clones WHERE branch_name = ?',
      args: ['wave/parity-conn'],
    });
    expect(after.rows[0].last_promoted_at).toBeNull();
  });

  it('skips the verifier entirely when parityVerifyEnabled is false', async () => {
    await insertCloneRow(db, { branch: 'wave/parity-off', createdAt: twoHoursAgo });

    let verifierCalled = false;
    const result = await promoteToProd({
      branchName: 'wave/parity-off',
      minSoakHours: 1,
      metaClient: db,
      now: fakeNow,
      runProdMigration: async () => ({ applied: [], skipped: [] }),
      parityVerifyEnabled: false,
      verifyAllTenantsParity: async () => {
        verifierCalled = true;
        return [];
      },
    });

    expect(verifierCalled).toBe(false);
    expect(result.parityResults).toEqual([]);
  });
});
