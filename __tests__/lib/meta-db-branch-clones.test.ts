/**
 * Tests for branch_db_clones CRUD helpers in lib/meta-db.ts and the
 * one-time migration script scripts/migrate-meta-branch-clones.ts.
 *
 * Uses a real in-memory libSQL client to execute against an actual SQLite
 * schema, giving full SQL fidelity without network calls.
 *
 * Injection pattern: __setMetaClientForTest() swaps the singleton so all
 * helpers in meta-db.ts use the in-memory client, then __resetMetaClient()
 * clears it in afterEach.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';
import { runMigration } from '@/scripts/migrate-meta-branch-clones';

// Env vars required by getMetaClient() even though we override the client.
process.env.META_TURSO_URL = 'libsql://test.example';
process.env.META_TURSO_AUTH_TOKEN = 'token';

// ---------------------------------------------------------------------------
// Schema DDL — mirrors the target production schema exactly.
// ---------------------------------------------------------------------------
const BRANCH_CLONES_DDL = `
  CREATE TABLE IF NOT EXISTS branch_db_clones (
    branch_name        TEXT PRIMARY KEY,
    turso_db_name      TEXT NOT NULL,
    turso_db_url       TEXT NOT NULL,
    turso_auth_token   TEXT NOT NULL,
    source_db_name     TEXT NOT NULL,
    created_at         TEXT NOT NULL,
    last_promoted_at   TEXT,
    prod_migration_at  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_branch_db_clones_created_at
    ON branch_db_clones(created_at);
`;

// ---------------------------------------------------------------------------
// Per-test in-memory DB setup
// ---------------------------------------------------------------------------
let memClient: Client;

async function createMemClient(): Promise<Client> {
  const client = createClient({ url: 'file::memory:' });
  // Execute DDL statements one at a time (libSQL batch may not work for multi-statement)
  await client.execute(`
    CREATE TABLE IF NOT EXISTS branch_db_clones (
      branch_name        TEXT PRIMARY KEY,
      turso_db_name      TEXT NOT NULL,
      turso_db_url       TEXT NOT NULL,
      turso_auth_token   TEXT NOT NULL,
      source_db_name     TEXT NOT NULL,
      created_at         TEXT NOT NULL,
      last_promoted_at   TEXT,
      prod_migration_at  TEXT
    )
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_branch_db_clones_created_at
      ON branch_db_clones(created_at)
  `);
  return client;
}

// Suppress unused-variable warning — DDL constant is for documentation.
void BRANCH_CLONES_DDL;

// ---------------------------------------------------------------------------
// Sample fixtures
// ---------------------------------------------------------------------------
const FIXTURE_A = {
  branchName: 'wave/19-option-c',
  tursoDbName: 'ft-wave-19-option-c',
  tursoDbUrl: 'libsql://ft-wave-19-option-c.turso.io',
  tursoAuthToken: 'token-abc',
  sourceDbName: 'acme-cattle',
};

const FIXTURE_B = {
  branchName: 'wave/20-multi-species',
  tursoDbName: 'ft-wave-20-multi-species',
  tursoDbUrl: 'libsql://ft-wave-20-multi-species.turso.io',
  tursoAuthToken: 'token-xyz',
  sourceDbName: 'acme-cattle',
};

// ---------------------------------------------------------------------------
// Helper: load subject after injecting the in-memory client
// ---------------------------------------------------------------------------
async function loadSubject() {
  const mod = await import('@/lib/meta-db');
  mod.__setMetaClientForTest(memClient);
  return mod;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('recordBranchClone', () => {
  beforeEach(async () => {
    memClient = await createMemClient();
  });

  afterEach(async () => {
    const mod = await import('@/lib/meta-db');
    mod.__resetMetaClient();
  });

  it('inserts a new row with created_at set to an ISO-8601 UTC string', async () => {
    const { recordBranchClone, getBranchClone } = await loadSubject();

    const before = new Date().toISOString();
    await recordBranchClone(FIXTURE_A);
    const after = new Date().toISOString();

    const row = await getBranchClone(FIXTURE_A.branchName);
    expect(row).not.toBeNull();
    expect(row!.branchName).toBe(FIXTURE_A.branchName);
    expect(row!.tursoDbName).toBe(FIXTURE_A.tursoDbName);
    expect(row!.tursoDbUrl).toBe(FIXTURE_A.tursoDbUrl);
    expect(row!.tursoAuthToken).toBe(FIXTURE_A.tursoAuthToken);
    expect(row!.sourceDbName).toBe(FIXTURE_A.sourceDbName);
    expect(row!.createdAt >= before).toBe(true);
    expect(row!.createdAt <= after).toBe(true);
    expect(row!.lastPromotedAt).toBeNull();
    expect(row!.prodMigrationAt).toBeNull();
  });

  it('replaces an existing row (INSERT OR REPLACE) and refreshes created_at', async () => {
    const { recordBranchClone, getBranchClone } = await loadSubject();

    await recordBranchClone(FIXTURE_A);
    const firstRow = await getBranchClone(FIXTURE_A.branchName);

    // Small delay to ensure new timestamp differs
    await new Promise((r) => setTimeout(r, 5));

    const updated = { ...FIXTURE_A, tursoDbUrl: 'libsql://new-url.turso.io' };
    await recordBranchClone(updated);
    const secondRow = await getBranchClone(FIXTURE_A.branchName);

    expect(secondRow!.tursoDbUrl).toBe('libsql://new-url.turso.io');
    expect(secondRow!.createdAt >= firstRow!.createdAt).toBe(true);
  });

  it('handles branch names with special characters (slashes, hyphens)', async () => {
    const { recordBranchClone, getBranchClone } = await loadSubject();

    const specialBranch = {
      ...FIXTURE_A,
      branchName: 'feat/some-feature_with.dots/and+plus',
    };
    await recordBranchClone(specialBranch);
    const row = await getBranchClone(specialBranch.branchName);
    expect(row!.branchName).toBe(specialBranch.branchName);
  });
});

describe('getBranchClone', () => {
  beforeEach(async () => {
    memClient = await createMemClient();
  });

  afterEach(async () => {
    const mod = await import('@/lib/meta-db');
    mod.__resetMetaClient();
  });

  it('returns null when branch does not exist', async () => {
    const { getBranchClone } = await loadSubject();

    const row = await getBranchClone('nonexistent-branch');
    expect(row).toBeNull();
  });

  it('returns the full record including nullable timestamp fields', async () => {
    const { recordBranchClone, getBranchClone } = await loadSubject();

    await recordBranchClone(FIXTURE_B);
    const row = await getBranchClone(FIXTURE_B.branchName);

    expect(row).toMatchObject({
      branchName: FIXTURE_B.branchName,
      tursoDbName: FIXTURE_B.tursoDbName,
      tursoDbUrl: FIXTURE_B.tursoDbUrl,
      tursoAuthToken: FIXTURE_B.tursoAuthToken,
      sourceDbName: FIXTURE_B.sourceDbName,
      lastPromotedAt: null,
      prodMigrationAt: null,
    });
    expect(typeof row!.createdAt).toBe('string');
    expect(row!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns null for empty string branch name', async () => {
    const { getBranchClone } = await loadSubject();
    const row = await getBranchClone('');
    expect(row).toBeNull();
  });
});

describe('listBranchClones', () => {
  beforeEach(async () => {
    memClient = await createMemClient();
  });

  afterEach(async () => {
    const mod = await import('@/lib/meta-db');
    mod.__resetMetaClient();
  });

  it('returns an empty array when no clones exist', async () => {
    const { listBranchClones } = await loadSubject();
    const rows = await listBranchClones();
    expect(rows).toEqual([]);
  });

  it('returns all clones ordered by created_at DESC', async () => {
    const { recordBranchClone, listBranchClones } = await loadSubject();

    await recordBranchClone(FIXTURE_A);
    await new Promise((r) => setTimeout(r, 5));
    await recordBranchClone(FIXTURE_B);

    const rows = await listBranchClones();
    expect(rows).toHaveLength(2);
    // FIXTURE_B inserted later → higher created_at → should come first
    expect(rows[0].branchName).toBe(FIXTURE_B.branchName);
    expect(rows[1].branchName).toBe(FIXTURE_A.branchName);
  });

  it('returns all fields for each row', async () => {
    const { recordBranchClone, listBranchClones } = await loadSubject();

    await recordBranchClone(FIXTURE_A);
    const rows = await listBranchClones();

    expect(rows[0]).toMatchObject({
      branchName: FIXTURE_A.branchName,
      tursoDbName: FIXTURE_A.tursoDbName,
      tursoDbUrl: FIXTURE_A.tursoDbUrl,
      tursoAuthToken: FIXTURE_A.tursoAuthToken,
      sourceDbName: FIXTURE_A.sourceDbName,
      lastPromotedAt: null,
      prodMigrationAt: null,
    });
  });

  it('handles 50+ rows without error (large dataset sanity check)', async () => {
    const { recordBranchClone, listBranchClones } = await loadSubject();

    const inserts = Array.from({ length: 50 }, (_, i) =>
      recordBranchClone({
        branchName: `wave/branch-${i.toString().padStart(3, '0')}`,
        tursoDbName: `ft-branch-${i}`,
        tursoDbUrl: `libsql://ft-branch-${i}.turso.io`,
        tursoAuthToken: `token-${i}`,
        sourceDbName: 'acme-cattle',
      }),
    );
    await Promise.all(inserts);

    const rows = await listBranchClones();
    expect(rows).toHaveLength(50);
  });
});

describe('markBranchClonePromoted', () => {
  beforeEach(async () => {
    memClient = await createMemClient();
  });

  afterEach(async () => {
    const mod = await import('@/lib/meta-db');
    mod.__resetMetaClient();
  });

  it('sets last_promoted_at to now and prod_migration_at to the provided ISO string', async () => {
    const { recordBranchClone, markBranchClonePromoted, getBranchClone } =
      await loadSubject();

    await recordBranchClone(FIXTURE_A);
    const prodMigAt = '2026-04-28T10:00:00.000Z';
    const before = new Date().toISOString();
    await markBranchClonePromoted(FIXTURE_A.branchName, prodMigAt);
    const after = new Date().toISOString();

    const row = await getBranchClone(FIXTURE_A.branchName);
    expect(row!.lastPromotedAt).not.toBeNull();
    expect(row!.lastPromotedAt! >= before).toBe(true);
    expect(row!.lastPromotedAt! <= after).toBe(true);
    expect(row!.prodMigrationAt).toBe(prodMigAt);
  });

  it('is idempotent — calling twice updates the timestamps again', async () => {
    const { recordBranchClone, markBranchClonePromoted, getBranchClone } =
      await loadSubject();

    await recordBranchClone(FIXTURE_A);

    await markBranchClonePromoted(FIXTURE_A.branchName, '2026-04-28T10:00:00.000Z');
    const firstRow = await getBranchClone(FIXTURE_A.branchName);

    await new Promise((r) => setTimeout(r, 5));

    await markBranchClonePromoted(FIXTURE_A.branchName, '2026-04-28T11:00:00.000Z');
    const secondRow = await getBranchClone(FIXTURE_A.branchName);

    expect(secondRow!.prodMigrationAt).toBe('2026-04-28T11:00:00.000Z');
    expect(secondRow!.lastPromotedAt! >= firstRow!.lastPromotedAt!).toBe(true);
  });

  it('does not throw when branch does not exist (no-op UPDATE)', async () => {
    const { markBranchClonePromoted } = await loadSubject();
    // Should resolve without error — SQLite UPDATE on no rows is a no-op
    await expect(
      markBranchClonePromoted('nonexistent', '2026-04-28T10:00:00.000Z'),
    ).resolves.toBeUndefined();
  });
});

describe('deleteBranchClone', () => {
  beforeEach(async () => {
    memClient = await createMemClient();
  });

  afterEach(async () => {
    const mod = await import('@/lib/meta-db');
    mod.__resetMetaClient();
  });

  it('removes the row so getBranchClone returns null afterwards', async () => {
    const { recordBranchClone, deleteBranchClone, getBranchClone } =
      await loadSubject();

    await recordBranchClone(FIXTURE_A);
    await deleteBranchClone(FIXTURE_A.branchName);

    const row = await getBranchClone(FIXTURE_A.branchName);
    expect(row).toBeNull();
  });

  it('is idempotent — deleting a non-existent branch does not throw', async () => {
    const { deleteBranchClone } = await loadSubject();
    await expect(
      deleteBranchClone('does-not-exist'),
    ).resolves.toBeUndefined();
  });

  it('only removes the targeted branch, leaves others intact', async () => {
    const { recordBranchClone, deleteBranchClone, listBranchClones } =
      await loadSubject();

    await recordBranchClone(FIXTURE_A);
    await recordBranchClone(FIXTURE_B);
    await deleteBranchClone(FIXTURE_A.branchName);

    const rows = await listBranchClones();
    expect(rows).toHaveLength(1);
    expect(rows[0].branchName).toBe(FIXTURE_B.branchName);
  });
});

// ---------------------------------------------------------------------------
// Migration script
// ---------------------------------------------------------------------------

describe('runMigration (migrate-meta-branch-clones)', () => {
  it('creates the branch_db_clones table on a fresh DB', async () => {
    const db = createClient({ url: 'file::memory:' });

    await runMigration(db);

    // Table should now exist — insert a row to verify schema is correct
    await expect(
      db.execute({
        sql: `INSERT INTO branch_db_clones
                (branch_name, turso_db_name, turso_db_url, turso_auth_token,
                 source_db_name, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          'test-branch',
          'ft-test',
          'libsql://ft-test.turso.io',
          'tok',
          'acme-cattle',
          new Date().toISOString(),
        ],
      }),
    ).resolves.toBeDefined();

    const res = await db.execute(`SELECT COUNT(*) as n FROM branch_db_clones`);
    expect(Number(res.rows[0].n)).toBe(1);
  });

  it('is idempotent — running a second time on the same DB is a no-op', async () => {
    const db = createClient({ url: 'file::memory:' });

    await runMigration(db);
    // Second run must not throw (table already exists)
    await expect(runMigration(db)).resolves.toBeUndefined();
  });

  it('creates the created_at index so order-by queries are covered', async () => {
    const db = createClient({ url: 'file::memory:' });

    await runMigration(db);

    const res = await db.execute({
      sql: `SELECT name FROM sqlite_master
            WHERE type = 'index'
              AND name = 'idx_branch_db_clones_created_at'`,
      args: [],
    });
    expect(res.rows).toHaveLength(1);
  });
});
