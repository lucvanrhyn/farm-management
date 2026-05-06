import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { rollbackPromote } from '@/lib/ops/promote-rollback';

async function seedBranchClonesTable(db: Client) {
  // Mirrors the canonical columns + the smoke-state additions from PRD #128.
  await db.execute(`
    CREATE TABLE branch_db_clones (
      branch_name        TEXT PRIMARY KEY,
      last_promoted_at   TEXT,
      prod_migration_at  TEXT,
      last_smoke_status  TEXT,
      last_smoke_at      TEXT
    )
  `);
}

describe('rollbackPromote', () => {
  let db: Client;
  beforeEach(async () => {
    db = createClient({ url: ':memory:' });
    await seedBranchClonesTable(db);
  });

  it('clears last_promoted_at + prod_migration_at on a row that was promoted', async () => {
    await db.execute({
      sql: `INSERT INTO branch_db_clones (branch_name, last_promoted_at, prod_migration_at) VALUES (?, ?, ?)`,
      args: ['wave/128', '2026-05-06T12:00:00.000Z', '2026-05-06T12:00:00.000Z'],
    });

    const result = await rollbackPromote({
      metaClient: db,
      branchName: 'wave/128',
      now: () => new Date('2026-05-06T12:05:00.000Z'),
    });

    expect(result.rowUpdated).toBe(true);
    expect(result.rolledBackAt).toBe('2026-05-06T12:05:00.000Z');

    const after = await db.execute({
      sql: 'SELECT last_promoted_at, prod_migration_at, last_smoke_status, last_smoke_at FROM branch_db_clones WHERE branch_name = ?',
      args: ['wave/128'],
    });
    const row = after.rows[0];
    expect(row.last_promoted_at).toBeNull();
    expect(row.prod_migration_at).toBeNull();
    expect(row.last_smoke_status).toBe('rolled_back');
    expect(row.last_smoke_at).toBe('2026-05-06T12:05:00.000Z');
  });

  it('returns rowUpdated:false when the branch does not exist (idempotent)', async () => {
    const result = await rollbackPromote({
      metaClient: db,
      branchName: 'wave/never-existed',
    });
    expect(result.rowUpdated).toBe(false);
  });

  it('returns rowUpdated:false when the row exists but was not promoted (idempotent)', async () => {
    await db.execute({
      sql: `INSERT INTO branch_db_clones (branch_name, last_promoted_at) VALUES (?, NULL)`,
      args: ['wave/128'],
    });
    const result = await rollbackPromote({
      metaClient: db,
      branchName: 'wave/128',
    });
    expect(result.rowUpdated).toBe(false);
  });
});
