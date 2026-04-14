import { describe, it, expect } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import {
  runMigration,
  columnExists,
  addColumnIfMissing,
} from '../migrate-meta-db-pricing';

async function makeFreshDb(): Promise<Client> {
  const db = createClient({ url: ':memory:' });
  await db.execute(`
    CREATE TABLE farms (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      turso_url TEXT NOT NULL,
      turso_auth_token TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'basic',
      subscription_status TEXT DEFAULT 'inactive',
      payfast_token TEXT,
      subscription_started_at TEXT,
      subscription_billing_date TEXT,
      logo_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return db;
}

describe('columnExists', () => {
  it('returns false for a missing column', async () => {
    const db = await makeFreshDb();
    expect(await columnExists(db, 'farms', 'does_not_exist')).toBe(false);
  });

  it('returns true for an existing column', async () => {
    const db = await makeFreshDb();
    expect(await columnExists(db, 'farms', 'slug')).toBe(true);
  });
});

describe('addColumnIfMissing', () => {
  it('adds a new column and returns true', async () => {
    const db = await makeFreshDb();
    const added = await addColumnIfMissing(db, 'farms', 'test_col', 'TEXT');
    expect(added).toBe(true);
    expect(await columnExists(db, 'farms', 'test_col')).toBe(true);
  });

  it('is idempotent: second call returns false', async () => {
    const db = await makeFreshDb();
    await addColumnIfMissing(db, 'farms', 'test_col', 'TEXT');
    const secondCall = await addColumnIfMissing(db, 'farms', 'test_col', 'TEXT');
    expect(secondCall).toBe(false);
  });
});

describe('runMigration', () => {
  it('adds all 4 farms billing columns', async () => {
    const db = await makeFreshDb();
    await runMigration(db);
    expect(await columnExists(db, 'farms', 'billing_frequency')).toBe(true);
    expect(await columnExists(db, 'farms', 'locked_lsu')).toBe(true);
    expect(await columnExists(db, 'farms', 'billing_amount_zar')).toBe(true);
    expect(await columnExists(db, 'farms', 'next_renewal_at')).toBe(true);
  });

  it('creates consulting_leads table with status index', async () => {
    const db = await makeFreshDb();
    await runMigration(db);
    const tbl = await db.execute({
      sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='consulting_leads'`,
      args: [],
    });
    expect(tbl.rows.length).toBe(1);
    const idx = await db.execute({
      sql: `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_consulting_leads_status'`,
      args: [],
    });
    expect(idx.rows.length).toBe(1);
  });

  it('creates consulting_engagements table with lead_id FK', async () => {
    const db = await makeFreshDb();
    await runMigration(db);
    const tbl = await db.execute({
      sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='consulting_engagements'`,
      args: [],
    });
    expect(tbl.rows.length).toBe(1);
    // Verify foreign key declaration
    const fk = await db.execute({
      sql: `SELECT * FROM pragma_foreign_key_list('consulting_engagements')`,
      args: [],
    });
    expect(fk.rows.length).toBeGreaterThan(0);
    expect(fk.rows[0].table).toBe('consulting_leads');
  });

  it('is idempotent: runMigration can be called twice without error', async () => {
    const db = await makeFreshDb();
    await runMigration(db);
    await runMigration(db); // should not throw
    // Columns still exist, not duplicated
    expect(await columnExists(db, 'farms', 'billing_frequency')).toBe(true);
  });

  it('inserts into consulting_leads after migration succeed', async () => {
    const db = await makeFreshDb();
    await runMigration(db);
    await db.execute({
      sql: `INSERT INTO consulting_leads (id, name, email, phone, farm_name, source, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ['l1', 'Test', 'a@b.c', '+27', 'Test Farm', 'marketing', 'new'],
    });
    const result = await db.execute({
      sql: `SELECT status FROM consulting_leads WHERE id = ?`,
      args: ['l1'],
    });
    expect(result.rows[0].status).toBe('new');
  });
});
